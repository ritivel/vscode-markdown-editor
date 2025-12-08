import * as vscode from 'vscode'
import * as NodePath from 'path'
const KeyVditorOptions = 'vditor.options'

function debug(...args: any[]) {
  console.log(...args)
}

function showError(msg: string) {
  vscode.window.showErrorMessage(`[markdown-editor] ${msg}`)
}

export function activate(context: vscode.ExtensionContext) {
  // Register custom text editor provider
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'markdown-editor.editor',
      new MarkdownCustomTextEditorProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
          enableFindWidget: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  )

  // Keep the command for backward compatibility and manual opening
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.openEditor',
      (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        EditorPanel.createOrShow(context, uri)
      }
    )
  )

  // Register command to apply decorations from Cline
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.applyDecorations',
      async (params: { uri: vscode.Uri; decorations: { added: number[]; deleted: number[]; modified: number[] } }) => {
        if (!params || !params.uri || !params.decorations) {
          debug('Invalid decoration parameters')
          return
        }
        const panel = EditorPanel.findPanelByUri(params.uri)
        if (panel) {
          // First, update the webview content to reflect the current document state
          // This ensures the webview shows the latest changes
          await panel.updateContent()

          // Then apply decorations
          panel.postMessage({
            command: 'apply-decorations',
            decorations: params.decorations,
          })
          debug('Applied decorations to markdown editor', params.decorations)
        } else {
          debug('No active markdown editor panel for file:', params.uri.fsPath)
        }
      }
    )
  )

  // Register command to clear decorations from Cline
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.clearDecorations',
      (params: { uri: vscode.Uri }) => {
        if (!params || !params.uri) {
          debug('Invalid clear decoration parameters')
          return
        }
        const panel = EditorPanel.findPanelByUri(params.uri)
        if (panel) {
          panel.postMessage({
            command: 'clear-decorations',
          })
          debug('Cleared decorations in markdown editor')
        } else {
          debug('No active markdown editor panel for file:', params.uri.fsPath)
        }
      }
    )
  )

  // Register command to clear selection highlights when attachment is removed in Cline
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.clearSelectionHighlights',
      (params: { uri: vscode.Uri }) => {
        if (!params || !params.uri) {
          debug('Invalid clear selection highlights parameters')
          return
        }
        const panel = EditorPanel.findPanelByUri(params.uri)
        if (panel) {
          panel.postMessage({
            command: 'clear-selection-highlights',
          })
          debug('Cleared selection highlights in markdown editor')
        } else {
          debug('No active markdown editor panel for file:', params.uri.fsPath)
        }
      }
    )
  )

  context.globalState.setKeysForSync([KeyVditorOptions])
}

/**
 * Custom Text Editor Provider for markdown files
 */
class MarkdownCustomTextEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Configure webview to allow access to file system resources
    // Set localResourceRoots on the webview options
    const webviewOptions = EditorPanel.getWebviewOptions(document.uri)
    webviewPanel.webview.options = {
      ...webviewPanel.webview.options,
      localResourceRoots: webviewOptions.localResourceRoots,
      enableScripts: true,
      enableCommandUris: true,
    }

    // Create EditorPanel instance for this custom editor
    const panel = EditorPanel.create(
      this.context,
      webviewPanel,
      this.context.extensionUri,
      document,
      document.uri
    )
    // Register this panel so it can be found by decoration commands
    EditorPanel.registerPanel(document.uri, panel)
  }
}

/**
 * Manages markdown editor webview panels
 */
class EditorPanel {
  /**
   * Track all active panels by URI
   */
  private static panels = new Map<string, EditorPanel>()

  /**
   * Track the currently active panel (for backward compatibility)
   */
  public static currentPanel: EditorPanel | undefined

  public static readonly viewType = 'markdown-editor'

  private _disposables: vscode.Disposable[] = []

  /**
   * Register a panel for a given URI
   */
  public static registerPanel(uri: vscode.Uri, panel: EditorPanel): void {
    EditorPanel.panels.set(uri.fsPath, panel)
    EditorPanel.currentPanel = panel
  }

  /**
   * Find a panel by URI
   */
  public static findPanelByUri(uri: vscode.Uri): EditorPanel | undefined {
    return EditorPanel.panels.get(uri.fsPath)
  }

  public static async createOrShow(
    context: vscode.ExtensionContext,
    uri?: vscode.Uri
  ) {
    const { extensionUri } = context
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    // Check if we already have a panel for this URI
    if (uri) {
      const existingPanel = EditorPanel.panels.get(uri.fsPath)
      if (existingPanel) {
        existingPanel._panel.reveal(column)
        EditorPanel.currentPanel = existingPanel
        return
      }
    }

    // If we have a current panel for a different URI, dispose it
    if (EditorPanel.currentPanel && uri && EditorPanel.currentPanel._uri.fsPath !== uri.fsPath) {
      EditorPanel.currentPanel.dispose()
    }

    // If we already have a panel, show it.
    if (EditorPanel.currentPanel && !uri) {
      EditorPanel.currentPanel._panel.reveal(column)
      return
    }

    if (!vscode.window.activeTextEditor && !uri) {
      showError(`Did not open markdown file!`)
      return
    }
    let doc: undefined | vscode.TextDocument
    // from context menu : 从当前打开的 textEditor 中寻找 是否有当前 markdown 的 editor, 有的话则绑定 document
    if (uri) {
      // 从右键打开文件，先打开文档然后开启自动同步，不然没法保存文件和同步到已经打开的document
      doc = await vscode.workspace.openTextDocument(uri)
    } else {
      doc = vscode.window.activeTextEditor?.document
      // from command mode
      if (doc && doc.languageId !== 'markdown') {
        showError(
          `Current file language is not markdown, got ${doc.languageId}`
        )
        return
      }
    }

    if (!doc) {
      showError(`Cannot find markdown file!`)
      return
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      EditorPanel.viewType,
      'markdown-editor',
      column || vscode.ViewColumn.One,
      EditorPanel.getWebviewOptions(uri || doc.uri)
    )

    const editorPanel = new EditorPanel(
      context,
      panel,
      extensionUri,
      doc,
      uri || doc.uri
    )
    EditorPanel.registerPanel(uri || doc.uri, editorPanel)
  }

  public static getFolders(): vscode.Uri[] {
    const data = []
    for (let i = 65; i <= 90; i++) {
      data.push(vscode.Uri.file(`${String.fromCharCode(i)}:/`))
    }
    return data
  }

  static getWebviewOptions(
    uri?: vscode.Uri
  ): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      // Enable javascript in the webview
      enableScripts: true,

            localResourceRoots: [vscode.Uri.file("/"), ...this.getFolders()],
      retainContextWhenHidden: true,
      enableCommandUris: true,
    }
  }
  private get _fsPath() {
    return this._uri.fsPath
  }

  static get config() {
    return vscode.workspace.getConfiguration('markdown-editor')
  }

  /**
   * Create an EditorPanel instance (for use by CustomTextEditorProvider)
   */
  public static create(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
    uri: vscode.Uri
  ): EditorPanel {
    return new EditorPanel(context, panel, extensionUri, document, uri)
  }

  private constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    public _document: vscode.TextDocument, // 当前有 markdown 编辑器
    public _uri = _document.uri // 从资源管理器打开，只有 uri 没有 _document
  ) {
    // Set the webview's initial html content

    this._init()

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
    let textEditTimer: NodeJS.Timeout | void
    // close EditorPanel when vsc editor is close
    vscode.workspace.onDidCloseTextDocument((e) => {
      if (e.fileName === this._fsPath) {
        this.dispose()
      }
    }, this._disposables)
    // Track if the last edit came from the webview to avoid circular updates
    let lastEditFromWebview = false

    // update EditorPanel when vsc editor changes
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.fileName !== this._document.fileName) {
        return
      }
      // 当 webview panel 激活时不将由 webview编辑导致的 vsc 编辑器更新同步回 webview
      // don't change webview panel when webview panel is focus (unless it's an external change)
      // However, if the edit didn't come from the webview, we should update even if active
      if (this._panel.active && lastEditFromWebview) {
        lastEditFromWebview = false
        return
      }
      lastEditFromWebview = false
      textEditTimer && clearTimeout(textEditTimer)
      textEditTimer = setTimeout(() => {
        this._update()
        this._updateEditTitle()
      }, 300)
    }, this._disposables)
    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        debug('msg from webview review', message, this._panel.active)

        const syncToEditor = async () => {
          debug('sync to editor', this._document, this._uri)
          if (this._document) {
            const edit = new vscode.WorkspaceEdit()
            edit.replace(
              this._document.uri,
              new vscode.Range(0, 0, this._document.lineCount, 0),
              message.content
            )
            await vscode.workspace.applyEdit(edit)
          } else if (this._uri) {
            await vscode.workspace.fs.writeFile(this._uri, message.content)
          } else {
            showError(`Cannot find original file to save!`)
          }
        }
        switch (message.command) {
          case 'ready':
            this._initialized = true
            this._update({
              type: 'init',
              options: {
                useVscodeThemeColor: EditorPanel.config.get<boolean>(
                  'useVscodeThemeColor'
                ),
                ...this._context.globalState.get(KeyVditorOptions),
              },
              theme:
                vscode.window.activeColorTheme.kind ===
                vscode.ColorThemeKind.Dark
                  ? 'dark'
                  : 'light',
            })
            break
          case 'save-options':
            this._context.globalState.update(KeyVditorOptions, message.options)
            break
          case 'info':
            vscode.window.showInformationMessage(message.content)
            break
          case 'error':
            showError(message.content)
            break
          case 'edit': {
            // 只有当 webview 处于编辑状态时才同步到 vsc 编辑器，避免重复刷新
            if (this._panel.active) {
              lastEditFromWebview = true
              await syncToEditor()
              this._updateEditTitle()
            }
            break
          }
          case 'reset-config': {
            await this._context.globalState.update(KeyVditorOptions, {})
            break
          }
          case 'save': {
            await syncToEditor()
            await this._document.save()
            this._updateEditTitle()
            // Regular save just saves the document - don't try to accept Cline changes
            // The user should use "Keep All" button if they want to accept pending Cline changes
            break
          }
          case 'cline-undo-changes': {
            // Execute Cline's reject file changes command
            try {
              await vscode.commands.executeCommand('cline.rejectFileChanges')
            } catch (error) {
              console.error('Failed to execute cline.rejectFileChanges:', error)
            }
            break
          }
          case 'cline-keep-changes': {
            // Execute Cline's accept file changes command
            try {
              // Get current document content as baseline (this should have Cline's changes)
              const currentDocContent = this._document ? this._document.getText() : ''

              // Get the current content from the webview to sync any user edits
              let webviewContent: string = currentDocContent

              try {
                // Request current content from webview with a timeout
                const contentPromise = new Promise<string>((resolve) => {
                  const timeout = setTimeout(() => {
                    // Fallback: use document content if webview doesn't respond in time
                    resolve(currentDocContent)
                  }, 300)

                  const disposable = this._panel.webview.onDidReceiveMessage((msg: any) => {
                    if (msg.command === 'current-content') {
                      clearTimeout(timeout)
                      disposable.dispose()
                      // Only use webview content if it's not empty
                      const content = msg.content || ''
                      resolve(content.length > 0 ? content : currentDocContent)
                    }
                  })

                  // Request content from webview
                  this._panel.webview.postMessage({ command: 'get-current-content' })
                })

                webviewContent = await contentPromise
              } catch (error) {
                debug('Failed to get webview content, using document content:', error)
                webviewContent = currentDocContent
              }

              // Only sync if webview content is different and not empty
              if (webviewContent && webviewContent.length > 0 && webviewContent !== currentDocContent && this._document) {
                debug('Syncing webview content to document')
                const edit = new vscode.WorkspaceEdit()
                edit.replace(
                  this._document.uri,
                  new vscode.Range(0, 0, this._document.lineCount, 0),
                  webviewContent
                )
                await vscode.workspace.applyEdit(edit)
              }

              // Save the document (only if it has content)
              if (this._document) {
                const contentToSave = this._document.getText()
                if (contentToSave.length > 0) {
                  await this._document.save()
                  this._updateEditTitle()
                } else {
                  debug('Warning: Document is empty, not saving')
                  // Don't proceed if document is empty
                  showError('Cannot save: document appears to be empty')
                  return
                }
              }

              // Accept the changes (this will clear decorations)
              await vscode.commands.executeCommand('cline.acceptFileChanges')

              // Refresh webview to show saved content (with a small delay to ensure save is complete)
              setTimeout(async () => {
                // Verify document still has content before updating
                if (this._document && this._document.getText().length > 0) {
                  await this.updateContent()
                } else {
                  debug('Warning: Document is empty after accept, not updating webview')
                }
              }, 150)
            } catch (error) {
              console.error('Failed to execute cline.acceptFileChanges:', error)
              // On error, try to refresh the webview if document has content
              if (this._document && this._document.getText().length > 0) {
                setTimeout(async () => {
                  await this.updateContent()
                }, 150)
              }
            }
            break
          }
          case 'upload': {
            const assetsFolder = EditorPanel.getAssetsFolder(this._uri)
            try {
              await vscode.workspace.fs.createDirectory(
                vscode.Uri.file(assetsFolder)
              )
            } catch (error) {
              console.error(error)
              showError(`Invalid image folder: ${assetsFolder}`)
            }
            await Promise.all(
              message.files.map(async (f: any) => {
                const content = Buffer.from(f.base64, 'base64')
                return vscode.workspace.fs.writeFile(
                  vscode.Uri.file(NodePath.join(assetsFolder, f.name)),
                  content
                )
              })
            )
            const files = message.files.map((f: any) =>
              NodePath.relative(
                NodePath.dirname(this._fsPath),
                NodePath.join(assetsFolder, f.name)
              ).replace(/\\/g, '/')
            )
            this._panel.webview.postMessage({
              command: 'uploaded',
              files,
            })
            break
          }
          case 'open-link': {
            let url = message.href
            if (!/^http/.test(url)) {
              url = NodePath.resolve(this._fsPath, '..', url)
            }
            vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url))
            break
          }
          case 'add-to-ritivel': {
            // Execute Cline's addToChatDirect command with the selected text and range
            // Range info allows Cline to know exact line numbers in the source file
            try {
              const filePath = this._uri.fsPath
              const range = message.range ? {
                startLine: message.range.startLine,
                startChar: message.range.startChar,
                endLine: message.range.endLine,
                endChar: message.range.endChar
              } : undefined

              await vscode.commands.executeCommand('cline.addToChatDirect', {
                selectedText: message.selectedText,
                filePath: filePath,
                language: 'markdown',
                range: range
              })
              debug('add-to-ritivel executed', {
                text: message.selectedText?.substring(0, 50),
                range: range
              })
            } catch (error) {
              console.error('Failed to execute cline.addToChatDirect:', error)
              // Fallback: try to focus Cline chat
              try {
                await vscode.commands.executeCommand('cline.focusChatInput')
              } catch (e) {
                console.error('Failed to focus Cline chat:', e)
              }
            }
            break
          }
          case 'quick-edit': {
            // Execute Cline's improveCodeDirect command with the selected text and range
            // Range info allows Cline to know exact line numbers in the source file
            try {
              const filePath = this._uri.fsPath
              const range = message.range ? {
                startLine: message.range.startLine,
                startChar: message.range.startChar,
                endLine: message.range.endLine,
                endChar: message.range.endChar
              } : undefined

              await vscode.commands.executeCommand('cline.improveCodeDirect', {
                selectedText: message.selectedText,
                filePath: filePath,
                language: 'markdown',
                range: range
              })
              debug('quick-edit executed', {
                text: message.selectedText?.substring(0, 50),
                range: range
              })
            } catch (error) {
              console.error('Failed to execute cline.improveCodeDirect:', error)
            }
            break
          }
        }
      },
      null,
      this._disposables
    )
  }

  static getAssetsFolder(uri: vscode.Uri) {
    const imageSaveFolder = (
      EditorPanel.config.get<string>('imageSaveFolder') || 'assets'
    )
      .replace(
        '${projectRoot}',
        vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath || ''
      )
      .replace('${file}', uri.fsPath)
      .replace(
        '${fileBasenameNoExtension}',
        NodePath.basename(uri.fsPath, NodePath.extname(uri.fsPath))
      )
      .replace('${dir}', NodePath.dirname(uri.fsPath))
    const assetsFolder = NodePath.resolve(
      NodePath.dirname(uri.fsPath),
      imageSaveFolder
    )
    return assetsFolder
  }

  /**
   * Post a message to the webview
   */
  public postMessage(message: any): void {
    this._panel.webview.postMessage(message)
  }

  /**
   * Update the webview content to match the current document
   * Only updates if content has actually changed
   */
  public async updateContent(force: boolean = false): Promise<void> {
    const currentDocContent = this._document ? this._document.getText() : ''

    // Send update message - the webview will check if content changed
    await this._update({
      type: 'update',
      options: {
        useVscodeThemeColor: EditorPanel.config.get<boolean>(
          'useVscodeThemeColor'
        ),
        ...this._context.globalState.get(KeyVditorOptions),
      },
      theme:
        vscode.window.activeColorTheme.kind ===
        vscode.ColorThemeKind.Dark
          ? 'dark'
          : 'light',
    })
  }

  public dispose() {
    // Remove from panels map
    EditorPanel.panels.delete(this._uri.fsPath)

    // Update currentPanel if it was this one
    if (EditorPanel.currentPanel === this) {
      EditorPanel.currentPanel = undefined
    }

    // Clean up our resources
    this._panel.dispose()

    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  private _initialized = false

  private _init() {
    const webview = this._panel.webview

    this._panel.webview.html = this._getHtmlForWebview(webview)
    this._panel.title = NodePath.basename(this._fsPath)
    this._initialized = false

    // For custom editors, ensure content is sent after a short delay
    // in case the 'ready' message doesn't arrive (fallback)
    const fallbackTimer = setTimeout(() => {
      if (!this._initialized && this._document) {
        debug('Fallback: Sending content without ready message')
        this._update({
          type: 'init',
          options: {
            useVscodeThemeColor: EditorPanel.config.get<boolean>(
              'useVscodeThemeColor'
            ),
            ...this._context.globalState.get(KeyVditorOptions),
          },
          theme:
            vscode.window.activeColorTheme.kind ===
            vscode.ColorThemeKind.Dark
              ? 'dark'
              : 'light',
        })
        this._initialized = true
      }
    }, 1000)

    // Store timer for cleanup
    this._disposables.push({
      dispose: () => clearTimeout(fallbackTimer)
    })
  }
  private _isEdit = false
  private _updateEditTitle() {
    const isEdit = this._document.isDirty
    if (isEdit !== this._isEdit) {
      this._isEdit = isEdit
      this._panel.title = `${isEdit ? `[edit]` : ''}${NodePath.basename(
        this._fsPath
      )}`
    }
  }

  // private fileToWebviewUri = (f: string) => {
  //   return this._panel.webview.asWebviewUri(vscode.Uri.file(f)).toString()
  // }

  private async _update(
    props: {
      type?: 'init' | 'update'
      options?: any
      theme?: 'dark' | 'light'
    } = { options: void 0 }
  ) {
    const md = this._document
      ? this._document.getText()
      : (await vscode.workspace.fs.readFile(this._uri)).toString()
    // const dir = NodePath.dirname(this._document.fileName)
    this._panel.webview.postMessage({
      command: 'update',
      content: md,
      ...props,
    })
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const toUri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, f))
    const baseHref =
      NodePath.dirname(
        webview.asWebviewUri(vscode.Uri.file(this._fsPath)).toString()
      ) + '/'
    const toMediaPath = (f: string) => `media/dist/${f}`
    const JsFiles = ['main.js'].map(toMediaPath).map(toUri)
    const CssFiles = ['main.css'].map(toMediaPath).map(toUri)

    return (
      `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<base href="${baseHref}" />


				${CssFiles.map((f) => `<link href="${f}" rel="stylesheet">`).join('\n')}

				<title>markdown editor</title>
        <style>` +
      EditorPanel.config.get<string>('customCss') +
      `</style>
			</head>
			<body>
				<div id="app"></div>


				${JsFiles.map((f) => `<script src="${f}"></script>`).join('\n')}
			</body>
			</html>`
    )
  }
}
