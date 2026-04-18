const vscode = require("vscode")
const { execSync } = require("child_process")
const { l10n } = vscode
const fs = require("fs")
const path = require("path")

const pythonCmd = process.platform === "win32" ? "python" : "python3"

function getTemplates() {
	const options = { timeout: 15000, stdio: "pipe" }
	const output = execSync("${pythonCmd} -m copy_template --list", options).toString()
	return output.split("\n").map(t => t.trim()).filter(Boolean)
}

async function fetchAndCache(cachePath) {
	const templates = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: l10n.t("loadingTemplates"),
			cancellable: false
		},
		async () => getTemplates()
	)
	fs.mkdirSync(path.dirname(cachePath), { recursive: true })
	fs.writeFileSync(cachePath, JSON.stringify(templates), "utf8")
	return templates
}

function activate(context) {
	const cachePath = path.join(context.globalStorageUri.fsPath, "templates.json")

	const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
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

			const parts = ["${pythonCmd} -m copy_template"]
			if (author) parts.push(`--author ${author}`)
			if (repo) parts.push(`--repo ${repo}`)

			try {
				execSync(parts.join(" "), { timeout: 10000, stdio: "pipe" })
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

			let templates // load templates from templates.json
            try {
                if (fs.existsSync(cachePath)) {
                    templates = JSON.parse(fs.readFileSync(cachePath, "utf8"))
                } else {
                    templates = await fetchAndCache(cachePath)
                }
            } catch (e) {
                const detail = e.stderr?.toString().trim() || e.message
                vscode.window.showErrorMessage(`${l10n.t("templatesFailed")}: ${detail}`)
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
                await fetchAndCache(cachePath)
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