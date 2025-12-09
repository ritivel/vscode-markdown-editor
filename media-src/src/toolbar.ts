import { t } from "./lang"
import { confirm } from "./utils"
import { parseFrontmatter, updateFrontmatter, showPageSettingsDialog } from "./page-settings"
import { exportToPdf, exportToDocx } from "./document-export"

export const toolbar = [
	// Row 1: Formatting & Lists (11 items)
	'headings',
	'bold',
	'italic',
	'strike',
	'link',
	'|',
	'list',
	'ordered-list',
	'check',
	'|',
	'quote',

	// Force Break to New Line
	{
		name: 'break',
		className: 'toolbar-break',
		icon: '',
		click: () => { }
	},

	// Row 2: Actions & Inserts (11 items)
	'undo',
	'redo',
	'|',
	'code',
	'inline-code',
	'table',
	'|',
	'upload',
	'line',
	'|',
	{
		hotkey: '⌘s',
		name: 'save',
		tipPosition: 'n',
		tip: t('save'),
		className: 'save',
		icon:
			'<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M810.667 938.667H213.333a128 128 0 01-128-128V213.333a128 128 0 01128-128h469.334a42.667 42.667 0 0130.293 12.374L926.293 311.04a42.667 42.667 0 0112.374 30.293v469.334a128 128 0 01-128 128zm-597.334-768a42.667 42.667 0 00-42.666 42.666v597.334a42.667 42.667 0 0042.666 42.666h597.334a42.667 42.667 0 0042.666-42.666v-451.84l-188.16-188.16z"/><path d="M725.333 938.667A42.667 42.667 0 01682.667 896V597.333H341.333V896A42.667 42.667 0 01256 896V554.667A42.667 42.667 0 01298.667 512h426.666A42.667 42.667 0 01768 554.667V896a42.667 42.667 0 01-42.667 42.667zM640 384H298.667A42.667 42.667 0 01256 341.333V128a42.667 42.667 0 0185.333 0v170.667H640A42.667 42.667 0 01640 384z"/></svg>',
		click() {
			vscode.postMessage({
				command: 'save',
				content: vditor.getValue(),
			})
		},
	},
	'|',
	{
		name: 'page-break',
		tipPosition: 's',
		tip: t('pageBreak'),
		icon: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" fill="currentColor"/><path d="M2 2h2v20H2zm18 0h2v20h-2z" fill="currentColor"/></svg>',
		click() {
			if (window.vditor) {
				vditor.insertValue('\n\n<!-- pagebreak -->\n\n')
			}
		},
	},
	{
		name: 'header-footer',
		tipPosition: 's',
		tip: t('pageSettings') + ' / ' + t('headerFooter'),
		icon: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M4 4h16v3H4zm0 13h16v3H4z" fill="currentColor"/><path d="M4 8h16v8H4z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
		click() {
			if (window.vditor) {
				const content = vditor.getValue()
				const { frontmatter } = parseFrontmatter(content)
				showPageSettingsDialog(frontmatter, (settings) => {
					const updated = updateFrontmatter(content, settings)
					vditor.setValue(updated)
					// Re-render pages with new settings
					setTimeout(() => {
						const renderFn = (window as any).renderPageBreaks
						if (renderFn && typeof renderFn === 'function') {
							renderFn()
						}
					}, 50)
					// Sync to editor
					vscode.postMessage({
						command: 'edit',
						content: updated,
					})
				})
			}
		},
	},
	'|',
	{
		name: 'export-pdf',
		tipPosition: 's',
		tip: t('exportPdf'),
		icon: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		click() {
			if (window.vditor) {
				const content = vditor.getValue()
				exportToPdf(content)
			}
		},
	},
	{
		name: 'export-docx',
		tipPosition: 's',
		tip: t('exportDocx'),
		icon: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		click() {
			if (window.vditor) {
				const content = vditor.getValue()
				const filename = 'document.docx'
				exportToDocx(content, filename)
			}
		},
	},
	'|',
	{
		name: 'more',
		tipPosition: 'sw',
		toolbar: [
			'emoji',
			'insert-before',
			'insert-after',
			'outdent',
			'indent',
			'both',
			'code-theme',
			'content-theme',
			'outline',
			'preview',
			{
				name: 'copy-markdown',
				icon: t('copyMarkdown'),
				async click() {
					try {
						await navigator.clipboard.writeText(vditor.getValue())
						vscode.postMessage({
							command: 'info',
							content: 'Copy Markdown successfully!',
						})
					} catch (error) {
						vscode.postMessage({
							command: 'error',
							content: `Copy Markdown failed! ${error.message}`,
						})
					}
				},
			},
			{
				name: 'copy-html',
				icon: t('copyHtml'),
				async click() {
					try {
						await navigator.clipboard.writeText(vditor.getHTML())
						vscode.postMessage({
							command: 'info',
							content: 'Copy HTML successfully!',
						})
					} catch (error) {
						vscode.postMessage({
							command: 'error',
							content: `Copy HTML failed! ${error.message}`,
						})
					}
				},
			},
			{
				name: 'reset-config',
				icon: t('resetConfig'),
				async click() {
					confirm(t('resetConfirm'), async () => {
						try {
							await vscode.postMessage({
								command: 'reset-config',
							})
							await vscode.postMessage({
								command: 'ready',
							})
							vscode.postMessage({
								command: 'info',
								content: 'Reset config successfully!',
							})
						} catch (error) {
							vscode.postMessage({
								command: 'error',
								content: 'Reset config failed!',
							})
						}
					})
				},
			},
			'devtools',
			'info',
			'help',
			{ name: 'edit-mode', tipPosition: 'e', },
		],
	},
].map((it: any) => {
	if (typeof it === 'string') {
		it = { name: it }
	}
	it.tipPosition = it.tipPosition || 's'
	return it
})
