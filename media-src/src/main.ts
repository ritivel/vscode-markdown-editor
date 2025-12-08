import './preload'

import {
  fileToBase64,
  fixCut,
  fixDarkTheme,
  fixLinkClick,
  fixPanelHover,
  handleToolbarClick,
  saveVditorOptions,
} from './utils'

import { merge } from 'lodash'
import Vditor from 'vditor'
import { format } from 'date-fns'
import 'vditor/dist/index.css'
import { t, lang } from './lang'
import { toolbar } from './toolbar'
import { fixTableIr } from './fix-table-ir'
import './main.css'

function initVditor(msg) {
  console.log('msg', msg)
  let inputTimer
  let defaultOptions: any = {}
  if (msg.theme === 'dark') {
    // vditor.setTheme('dark', 'dark')
    defaultOptions = merge(defaultOptions, {
      theme: 'dark',
      preview: {
        theme: {
          current: 'dark',
        },
      }
    })
  }
  defaultOptions = merge(defaultOptions, msg.options, {
    preview: {
      math: {
        inlineDigit: true,
      }
    }
  })
  if (window.vditor) {
    vditor.destroy()
    window.vditor = null
  }
  window.vditor = new Vditor('app', {
    width: '100%',
    height: '100%',
    minHeight: '100%',
    lang,
    value: msg.content,
    mode: 'ir',
    cache: { enable: false },
    toolbar,
    toolbarConfig: { pin: true },
    ...defaultOptions,
    after() {
      fixDarkTheme()
      handleToolbarClick()
      fixTableIr()
      fixPanelHover()
    },
    input() {
      inputTimer && clearTimeout(inputTimer)
      inputTimer = setTimeout(() => {
        vscode.postMessage({ command: 'edit', content: vditor.getValue() })
      }, 100)
    },
    upload: {
      url: '/fuzzy', // 没有 url 参数粘贴图片无法上传 see: https://github.com/Vanessa219/vditor/blob/d7628a0a7cfe5d28b055469bf06fb0ba5cfaa1b2/src/ts/util/fixBrowserBehavior.ts#L1409
      async handler(files) {
        // console.log('files', files)
        let fileInfos = await Promise.all(
          files.map(async (f) => {
            const d = new Date()
            return {
              base64: await fileToBase64(f),
              name: `${format(new Date(), 'yyyyMMdd_HHmmss')}_${f.name}`.replace(
                /[^\w-_.]+/,
                '_'
              ),
            }
          })
        )
        vscode.postMessage({
          command: 'upload',
          files: fileInfos,
        })
      },
    },
  })
}

window.addEventListener('message', (e) => {
  const msg = e.data
  // console.log('msg from vscode', msg)
  switch (msg.command) {
    case 'update': {
      if (msg.type === 'init') {
        if (msg.options && msg.options.useVscodeThemeColor) {
          document.body.setAttribute('data-use-vscode-theme-color', '1')
        } else {
          document.body.setAttribute('data-use-vscode-theme-color', '0')
        }
        try {
          initVditor(msg)
        } catch (error) {
          // reset options when error
          console.error(error)
          initVditor({content: msg.content})
          saveVditorOptions()
        }
        console.log('initVditor')
      } else {
        vditor.setValue(msg.content)
        console.log('setValue')
        // Clear decorations when content is updated externally
        clearDecorations()
      }
      break
    }
    case 'uploaded': {
      msg.files.forEach((f) => {
        if (f.endsWith('.wav')) {
          vditor.insertValue(
            `\n\n<audio controls="controls" src="${f}"></audio>\n\n`
          )
        } else {
          const i = new Image()
          i.src = f
          i.onload = () => {
            vditor.insertValue(`\n\n![](${f})\n\n`)
          }
          i.onerror = () => {
            vditor.insertValue(`\n\n[${f.split('/').slice(-1)[0]}](${f})\n\n`)
          }
        }
      })
      break
    }
    case 'apply-decorations': {
      console.log('[MarkdownEditor] Received apply-decorations command:', msg.decorations)
      // Wait for Vditor to be ready if it's still initializing
      if (!window.vditor) {
        console.log('[MarkdownEditor] Vditor not ready, waiting...')
        setTimeout(() => {
          applyDecorationsToVditor(msg.decorations)
        }, 500)
      } else {
        applyDecorationsToVditor(msg.decorations)
      }
      break
    }
    case 'clear-decorations': {
      clearDecorations()
      break
    }
    default:
      break
  }
})

fixLinkClick()
fixCut()

/**
 * Apply decorations to Vditor's rendered markdown
 * Maps line numbers to DOM elements and applies CSS classes
 */
function applyDecorationsToVditor(decorations: { added: number[]; deleted: number[]; modified: number[] }) {
  if (!window.vditor || !decorations) {
    console.log('[MarkdownEditor] Vditor not available or no decorations')
    return
  }

  console.log('[MarkdownEditor] Applying decorations:', decorations)

  // Clear existing decorations first
  clearDecorations()

  // Wait a bit for Vditor to render if needed
  setTimeout(() => {
    // Get the Vditor IR container
    const irContainer = document.querySelector('.vditor-ir')
    if (!irContainer) {
      console.log('[MarkdownEditor] Vditor IR container not found')
      return
    }

    // Get the markdown content to map line numbers
    const content = vditor.getValue()
    const lines = content.split('\n')
    console.log(`[MarkdownEditor] Content has ${lines.length} lines`)

    // Vditor IR mode renders markdown as HTML elements
    // We need to find which DOM elements correspond to which source lines
    // Better approach: Use Vditor's line structure - each line in IR mode typically maps to a block element

    // Get all block-level elements (p, div, h1-h6, li, etc.)
    const blockElements = Array.from(irContainer.querySelectorAll('p, div.vditor-ir__block, h1, h2, h3, h4, h5, h6, li, pre, blockquote, hr'))

    // Create a map of line numbers to elements
    // Strategy: Match source lines with rendered blocks by position and content
    const lineToElements = new Map<number, Element[]>()

    // For each source line, try to find corresponding DOM element
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const lineText = lines[lineNum].trim()
      if (!lineText) {
        continue
      }

      // Find block elements that contain this line's text
      const matchingBlocks = blockElements.filter((block) => {
        const blockText = block.textContent || ''
        // Check if block contains the line text or vice versa
        return blockText.includes(lineText) || lineText.includes(blockText.trim())
      })

      if (matchingBlocks.length > 0) {
        lineToElements.set(lineNum, matchingBlocks)
      } else {
        // Fallback: use block elements in order (approximate mapping)
        if (lineNum < blockElements.length) {
          lineToElements.set(lineNum, [blockElements[lineNum]])
        }
      }
    }

    // Apply decoration classes
    const applyClass = (lineNum: number, className: string) => {
      const elements = lineToElements.get(lineNum)
      if (elements && elements.length > 0) {
        elements.forEach((el) => {
          el.classList.add(className)
          // Also apply to parent container if it's a wrapper
          let parent = el.parentElement
          while (parent && parent !== irContainer) {
            if (parent.classList.contains('vditor-ir__block') || parent.tagName === 'DIV') {
              parent.classList.add(className)
              break
            }
            parent = parent.parentElement
          }
        })
        console.log(`[MarkdownEditor] Applied ${className} to line ${lineNum}`)
      } else {
        console.log(`[MarkdownEditor] Could not find element for line ${lineNum}`)
      }
    }

    // Apply added line decorations
    decorations.added.forEach((lineNum) => {
      applyClass(lineNum, 'cline-added-line')
    })

    // Apply deleted line decorations
    decorations.deleted.forEach((lineNum) => {
      applyClass(lineNum, 'cline-deleted-line')
    })

    // Apply modified line decorations
    decorations.modified.forEach((lineNum) => {
      applyClass(lineNum, 'cline-modified-line')
    })

    console.log(
      `[MarkdownEditor] Applied decorations: ${decorations.added.length} added, ${decorations.deleted.length} deleted, ${decorations.modified.length} modified`
    )
  }, 200) // Wait for Vditor to finish rendering
}

/**
 * Clear all decoration classes from Vditor DOM
 */
function clearDecorations() {
  if (!window.vditor) {
    return
  }

  const irContainer = document.querySelector('.vditor-ir')
  if (!irContainer) {
    return
  }

  // Remove all decoration classes
  const elements = irContainer.querySelectorAll('.cline-added-line, .cline-deleted-line, .cline-modified-line')
  elements.forEach((el) => {
    el.classList.remove('cline-added-line', 'cline-deleted-line', 'cline-modified-line')
  })

  console.log('[MarkdownEditor] Cleared all decorations')
}

vscode.postMessage({ command: 'ready' })
