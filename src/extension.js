const vscode = require("vscode")
const { exec } = require("child_process")
const { promisify } = require("util")
const { l10n } = vscode
const fs = require("fs")
const path = require("path")
const os = require("os")

const execAsync = promisify(exec)

const pythonCmd = process.platform === "win32" ? "python" : "python3"

function getDataPath() {
	const home = os.homedir()
	let baseDir

	if (process.platform === "win32") {
		baseDir = path.join(home, "AppData", "Local")
	} else if (process.platform === "linux") {
		baseDir = path.join(home, ".local", "share")
	} else if (process.platform === "darwin") {
		baseDir = path.join(home, "Library", "Application Support")
	} else {
		throw new Error(`Unsupported platform: ${process.platform}`)
	}

	return path.join(baseDir, "copy-template", "data.json")
}

function getTemplates() {
	const dataPath = getDataPath()

	if (!fs.existsSync(dataPath)) {
		throw new Error("Data file not found. Please refresh templates.")
	}

	const content = fs.readFileSync(dataPath, "utf8")
	const data = JSON.parse(content)
	return data.templates || []
}

async function updateTemplatesCache() {
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: l10n.t("loadingTemplates"),
			cancellable: false
		},
		() => execAsync(`${pythonCmd} -m copy_template --update`, { timeout: 20000 })
	)
}

function activate(context) {
	const onConfigChange = vscode.workspace.onDidChangeConfiguration(async (e) => {
		if (
			e.affectsConfiguration("copy-template.author") ||
			e.affectsConfiguration("copy-template.repo")
		) {
			const config = vscode.workspace.getConfiguration("copy-template")
			const author = config.get("author")
			const repo = config.get("repo")

			if (!author) {
				vscode.window.showErrorMessage(l10n.t("noAuthor"))
				return
			}

			if (!repo) {
				vscode.window.showErrorMessage(l10n.t("noRepo"))
				return
			}

			const parts = [`${pythonCmd} -m copy_template`]
			if (author) parts.push(`--author ${author}`)
			if (repo) parts.push(`--repo ${repo}`)

			try {
				await execAsync(parts.join(" "), { timeout: 10000, stdio: "pipe" })
				vscode.window.showInformationMessage(l10n.t("settingsSaved"))
			} catch (e) {
				const detail = e.stderr?.toString().trim() || e.message
				vscode.window.showErrorMessage(`${l10n.t("settingsFailed")}: ${detail}`)
			}
		}
	})

	const createProject = vscode.commands.registerCommand(
		"copy-template-extension.createProject",
		async () => {
			const config = vscode.workspace.getConfiguration("copy-template")
			const defaultFolder = config.get("defaultProjectsFolder")

			if (!defaultFolder) {
				vscode.window.showErrorMessage(l10n.t("noDefaultFolder"))
				return
			}

			let templates // load templates from data.json
            try {
                templates = getTemplates()
            } catch (e) {
                const detail = e.message
                vscode.window.showErrorMessage(`${l10n.t("templatesFailed")}: ${detail}`)
                return
            }

			if (templates.length === 0) {
				vscode.window.showErrorMessage(l10n.t("noTemplates"))
				return
			}

			const template = await vscode.window.showQuickPick(templates, {
				placeHolder: "project-name"
			})
			if (!template) return

			const folder = await vscode.window.showInputBox({
				prompt: l10n.t("promptFolder"),
				placeHolder: "project-folder"
			})
			if (!folder) return

			const targetPath = path.join(defaultFolder, folder)

			const task = new vscode.Task(
				{ type: "shell" },
				vscode.TaskScope.Workspace,
				"copy-template",
				"copy-template",
				new vscode.ShellExecution(pythonCmd, ["-m", "copy_template", template, targetPath])
			)

			task.presentationOptions = {
				echo: false,
				showReuseMessage: false,
				clear: true,
				close: true
			}

			const execution = await vscode.tasks.executeTask(task)
			const disposable = vscode.tasks.onDidEndTaskProcess(async e => {
				if (e.execution !== execution) return
				disposable.dispose()
				if (e.exitCode !== 0) return

				await vscode.commands.executeCommand(
					"vscode.openFolder",
					vscode.Uri.file(targetPath)
				)
			})
			context.subscriptions.push(disposable)
		}
	)

	const refreshTemplates = vscode.commands.registerCommand(
		"copy-template-extension.refreshTemplates",
		async () => {
			try {
                await updateTemplatesCache()
                vscode.window.showInformationMessage(l10n.t("templatesRefreshed"))
            } catch (e) {
                const detail = e.stderr?.toString().trim() || e.message
                vscode.window.showErrorMessage(`${l10n.t("templatesFailed")}: ${detail}`)
            }
		}
	)

	context.subscriptions.push(onConfigChange, createProject, refreshTemplates)
}

function deactivate() {}

module.exports = { activate, deactivate }