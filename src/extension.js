const vscode = require("vscode")
const { exec } = require("child_process")
const { promisify } = require("util")
const { l10n } = vscode
const fs = require("fs/promises")
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

async function getData(dataPath) {
	try {
		const content = await fs.readFile(dataPath, "utf8")
		return JSON.parse(content)
	} catch (e) {
		if (e.code === "ENOENT") {
			throw new Error("Data file not found. Please refresh templates.")
		}

		throw e
	}
}

async function getTemplates(dataPath) {
	const data = await getData(dataPath)
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
	const dataPath = getDataPath()

	const onConfigChange = vscode.workspace.onDidChangeConfiguration(async (e) => {
		if (
			e.affectsConfiguration("copy-template.author") ||
			e.affectsConfiguration("copy-template.repo")
		) {
			const config = vscode.workspace.getConfiguration("copy-template")
			const author = config.get("author")
			const repo = config.get("repo")

			try {
				let data
				try {
					data = await getData(dataPath)
				} catch (e) {
					data = { author: "", repo: "", templates: [] }
				}

				data.author = author || ""
				data.repo = repo || ""

				await fs.mkdir(path.dirname(dataPath), { recursive: true })
				await fs.writeFile(dataPath, JSON.stringify(data), "utf8")

				vscode.window.showInformationMessage(l10n.t("settingsSaved"))
			} catch (e) {
				const detail = e.message
				vscode.window.showErrorMessage(`${l10n.t("settingsFailed")}: ${detail}`)
			}
		}
	})

	const createProject = vscode.commands.registerCommand(
		"copy-template-extension.createProject",
		async () => {
			const config = vscode.workspace.getConfiguration("copy-template")
			const defaultFolder = config.get("defaultProjectsFolder")

			if (!config.get("author")) {
				vscode.window.showErrorMessage(l10n.t("noAuthor"))
				return
			}

			if (!config.get("repo")) {
				vscode.window.showErrorMessage(l10n.t("noRepo"))
				return
			}

			if (!defaultFolder) {
				vscode.window.showErrorMessage(l10n.t("noDefaultFolder"))
				return
			}

			let templates // load templates from data.json
            try {
                templates = await getTemplates(dataPath)
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

			let disposable
			disposable = vscode.tasks.onDidEndTaskProcess(async e => {
				if (e.execution.task !== task) return
				disposable.dispose()
				if (e.exitCode !== 0) return

				await vscode.commands.executeCommand(
					"vscode.openFolder",
					vscode.Uri.file(targetPath)
				)
			})

			await vscode.tasks.executeTask(task)
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