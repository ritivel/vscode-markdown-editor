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
import { parseFrontmatter, updateFrontmatter, showPageSettingsDialog, PageSize } from './page-settings'
import { exportToPdf, exportToDocx } from './document-export'
import './main.css'

/**
 * Render page break guides (overlay) without modifying DOM structure
 */
function renderPageBreaks() {
  if (!window.vditor) return

  const irContainer = document.querySelector('.vditor-ir') as HTMLElement
  if (!irContainer) return

  // Get markdown content and parse frontmatter for page size
  const markdown = vditor.getValue()
  const { frontmatter } = parseFrontmatter(markdown)
  const pageSize: PageSize = frontmatter.pageSize || 'A4'

  // Update container data attribute
  irContainer.setAttribute('data-page-size', pageSize)

  // Render guides
  renderPageGuides(irContainer, pageSize)
}

/**
 * Get the maximum content height for a page based on page size
 */
function getPageHeight(pageSize: string): number {
  // Page heights in pixels (at 96 DPI)
  const pageHeights: Record<string, number> = {
    'A3': 1587,
    'A4': 1123,
    'A5': 794,
    'Letter': 1056,
    'Legal': 1344,
    'Tabloid': 1632
  }

  return pageHeights[pageSize] || 1123
}

/**
 * Render page guides as an overlay
 */
function renderPageGuides(container: HTMLElement, pageSize: string) {
  // Remove existing overlay
  const existingOverlay = document.getElementById('page-guide-overlay')
  if (existingOverlay) {
    existingOverlay.remove()
  }

  // Create overlay container
  const overlay = document.createElement('div')
  overlay.id = 'page-guide-overlay'
  overlay.className = 'page-guide-overlay'

  // Calculate heights
  const pageHeight = getPageHeight(pageSize)
  // Margins (96px = 1 inch)
  const marginY = 96
  const contentHeight = pageHeight - (marginY * 2)

  // Get all block elements to measure content
  // We don't measure exact content height because it's dynamic,
  // instead we place guides at fixed intervals relative to the document flow?
  // No, that doesn't account for content density.
  // We need to just place guides at fixed pixel intervals from the top of the container.

  const containerHeight = container.scrollHeight
  const totalPages = Math.ceil(containerHeight / contentHeight) + 1

  // Draw page separators
  for (let i = 1; i < totalPages; i++) {
    const top = i * contentHeight + (i * marginY * 2) // Rough approximation including margins if we were printing
    // Actually, for an editor view without physical pages, we just want to show where the break is.
    // Let's assume the editor is a continuous scroll.
    // The print output will slice this content.
    // If we want WYSIWYG, we usually paginate.
    // If the user wants "just how the page started i want it to end",
    // simply drawing a line every X pixels is the most robust way that doesn't break the editor.

    // However, simply drawing lines at 1123px intervals is naive if elements have margins.
    // But it's the best non-destructive approximation.

    // Let's use the pageHeight (e.g. 1123px for A4) as the interval.
    const breakTop = i * pageHeight

    if (breakTop > containerHeight) break

    const guide = document.createElement('div')
    guide.className = 'page-guide-line'
    guide.style.top = `${breakTop}px`
    guide.innerHTML = `<span class="page-guide-label">Page ${i} End / Page ${i + 1} Start</span>`
    overlay.appendChild(guide)
  }

  // Append overlay to container
  // We need to make sure container is positioned relative
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative'
  }
  container.appendChild(overlay)
}

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
      renderPageBreaks()
    },
    input() {
      inputTimer && clearTimeout(inputTimer)
      inputTimer = setTimeout(() => {
        vscode.postMessage({ command: 'edit', content: vditor.getValue() })
        // Re-render page breaks after content changes (with longer delay to ensure DOM is updated)
        setTimeout(() => renderPageBreaks(), 150)
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
        // Only clear decorations if content actually changed
        const currentContent = vditor.getValue()
        if (currentContent !== msg.content) {
          vditor.setValue(msg.content)
          console.log('setValue - content updated')
          // Clear decorations when content is updated externally
          clearDecorations()
          // Re-render page breaks (with delay to ensure DOM is updated)
          setTimeout(() => renderPageBreaks(), 200)
        } else {
          console.log('setValue - content unchanged, skipping update')
        }
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
    case 'clear-selection-highlights': {
      // Clear selection highlights when attachment is removed in Cline
      const clearFn = (window as any).clearSelectionHighlights
      if (clearFn && typeof clearFn === 'function') {
        clearFn()
      }
      break
    }
    case 'get-current-content': {
      // Send current content back to extension
      if (window.vditor) {
        const content = vditor.getValue()
        vscode.postMessage({
          command: 'current-content',
          content: content
        })
      }
      break
    }
    case 'insert-page-break': {
      if (window.vditor) {
        vditor.insertValue('\n\n<!-- pagebreak -->\n\n')
      }
      break
    }
    case 'open-page-settings': {
      if (window.vditor) {
        const content = vditor.getValue()
        const { frontmatter } = parseFrontmatter(content)
        showPageSettingsDialog(frontmatter, (settings) => {
          const updated = updateFrontmatter(content, settings)
          vditor.setValue(updated)
          // Re-render pages with new settings
          setTimeout(() => renderPageBreaks(), 50)
          // Sync to editor
          vscode.postMessage({
            command: 'edit',
            content: updated,
          })
        })
      }
      break
    }
    case 'export-pdf': {
      if (window.vditor) {
        const content = vditor.getValue()
        exportToPdf(content)
      }
      break
    }
    case 'export-docx': {
      if (window.vditor) {
        const content = vditor.getValue()
        // Get filename from document or use default
        const filename = 'document.docx'
        exportToDocx(content, filename)
      }
      break
    }
    default:
      break
  }
})

fixLinkClick()
fixCut()

// Initialize selection context menu
initSelectionContextMenu()

/**
 * Selection info with text and line range mapping
 */
interface SelectionInfo {
  text: string
  startLine: number  // 0-indexed line number in source markdown
  endLine: number    // 0-indexed line number in source markdown
  startChar: number  // character offset in start line
  endChar: number    // character offset in end line
}

/**
 * Find the line range in source markdown that corresponds to selected text
 * This maps the rendered selection back to the original markdown lines
 */
function getSelectionLineRange(selectedText: string): SelectionInfo | null {
  if (!window.vditor || !selectedText) {
    return null
  }

  const sourceMarkdown = vditor.getValue()
  const lines = sourceMarkdown.split('\n')

  // Normalize the selected text (remove extra whitespace that might be added by rendering)
  const normalizedSelection = selectedText.replace(/\s+/g, ' ').trim()

  // Try to find exact match first
  let matchIndex = sourceMarkdown.indexOf(selectedText)

  // If no exact match, try normalized matching
  if (matchIndex === -1) {
    // Create a normalized version of source for matching
    const normalizedSource = sourceMarkdown.replace(/\s+/g, ' ')
    const normalizedMatchIndex = normalizedSource.indexOf(normalizedSelection)

    if (normalizedMatchIndex !== -1) {
      // Map back to original position by counting non-collapsed whitespace
      let originalPos = 0
      let normalizedPos = 0
      while (normalizedPos < normalizedMatchIndex && originalPos < sourceMarkdown.length) {
        if (/\s/.test(sourceMarkdown[originalPos])) {
          // Skip consecutive whitespace in original
          while (originalPos < sourceMarkdown.length - 1 && /\s/.test(sourceMarkdown[originalPos + 1])) {
            originalPos++
          }
        }
        originalPos++
        normalizedPos++
      }
      matchIndex = originalPos
    }
  }

  if (matchIndex === -1) {
    // Fallback: try line-by-line matching for the first line of selection
    const firstSelectionLine = selectedText.split('\n')[0].trim()
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(firstSelectionLine)) {
        const selectionLines = selectedText.split('\n')
        return {
          text: selectedText,
          startLine: i,
          endLine: Math.min(i + selectionLines.length - 1, lines.length - 1),
          startChar: lines[i].indexOf(firstSelectionLine),
          endChar: selectionLines.length === 1
            ? lines[i].indexOf(firstSelectionLine) + firstSelectionLine.length
            : selectionLines[selectionLines.length - 1].length
        }
      }
    }

    // Last resort: return null if we can't find a match
    console.log('[MarkdownEditor] Could not find selection in source:', selectedText.substring(0, 50))
    return null
  }

  // Calculate line numbers from match index
  let charCount = 0
  let startLine = 0
  let startChar = 0

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + 1 // +1 for newline
    if (charCount + lineLength > matchIndex) {
      startLine = i
      startChar = matchIndex - charCount
      break
    }
    charCount += lineLength
  }

  // Find end line
  const endIndex = matchIndex + selectedText.length
  charCount = 0
  let endLine = startLine
  let endChar = startChar + selectedText.length

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + 1
    if (charCount + lineLength > endIndex) {
      endLine = i
      endChar = endIndex - charCount
      break
    }
    charCount += lineLength
  }

  console.log(`[MarkdownEditor] Selection mapped to lines ${startLine + 1}-${endLine + 1}`)

  return {
    text: selectedText,
    startLine,
    endLine,
    startChar,
    endChar
  }
}

/**
 * Initialize the selection context menu for "Add to Ritivel" and "Quick Edit" actions
 */
function initSelectionContextMenu() {
  // Create the context menu element
  const menu = document.createElement('div')
  menu.id = 'selection-context-menu'
  menu.className = 'selection-context-menu'
  menu.innerHTML = `
    <button class="context-btn" id="add-to-ritivel-btn">
      <svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
        <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
      </svg>
      Add to Ritivel
      <span class="btn-shortcut">⌘'</span>
    </button>
    <div class="context-divider"></div>
    <button class="context-btn" id="quick-edit-btn">
      <svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
      </svg>
      Quick Edit
      <span class="btn-shortcut">⌥⌘K</span>
    </button>
  `
  document.body.appendChild(menu)

  let currentSelection: SelectionInfo | null = null
  let hideTimeout: ReturnType<typeof setTimeout> | null = null
  let justAddedToChat = false // Flag to prevent clearing highlight when adding to chat

  // Handle selection changes
  document.addEventListener('mouseup', (e) => {
    // Delay to allow selection to be finalized
    setTimeout(() => {
      // Don't clear highlights if we just added to chat
      if (justAddedToChat) {
        return
      }

      const selection = window.getSelection()
      const text = selection?.toString().trim() || ''

      if (text && text.length > 0) {
        currentSelection = getSelectionLineRange(text)
        if (currentSelection) {
          showSelectionMenu(e.clientX, e.clientY)
        }
      } else {
        hideSelectionMenu()
        // Don't clear highlights - they should only be cleared when attachment is removed in Cline
      }
    }, 10)
  })

  // Hide menu when clicking outside
  document.addEventListener('mousedown', (e) => {
    // If we just added to chat, don't clear highlights yet
    if (justAddedToChat) {
      justAddedToChat = false
      return
    }

    const target = e.target as HTMLElement
    if (!menu.contains(target)) {
      hideSelectionMenu()
      // Don't clear highlights - they should only be cleared when attachment is removed in Cline
    }
  })

  // Hide menu when pressing escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideSelectionMenu()
      // Don't clear highlights - they should only be cleared when attachment is removed in Cline
    }
  })

  // Handle button clicks
  document.getElementById('add-to-ritivel-btn')?.addEventListener('click', (e) => {
    if (currentSelection) {
      // Set flag to prevent clearing highlight
      justAddedToChat = true

      vscode.postMessage({
        command: 'add-to-ritivel',
        selectedText: currentSelection.text,
        range: {
          startLine: currentSelection.startLine,
          startChar: currentSelection.startChar,
          endLine: currentSelection.endLine,
          endChar: currentSelection.endChar
        }
      })
      // Hide menu immediately
      menu.classList.remove('visible')
      if (hideTimeout) {
        clearTimeout(hideTimeout)
        hideTimeout = null
      }
      // Mark selection as added to chat with different color
      markSelectionAsAddedToChat()

      // Reset flag after a short delay to allow normal click handling
      setTimeout(() => {
        justAddedToChat = false
      }, 200)
    }
  })

  document.getElementById('quick-edit-btn')?.addEventListener('click', (e) => {
    if (currentSelection) {
      // Set flag to prevent clearing highlight
      justAddedToChat = true

      vscode.postMessage({
        command: 'quick-edit',
        selectedText: currentSelection.text,
        range: {
          startLine: currentSelection.startLine,
          startChar: currentSelection.startChar,
          endLine: currentSelection.endLine,
          endChar: currentSelection.endChar
        }
      })
      // Hide menu immediately
      menu.classList.remove('visible')
      if (hideTimeout) {
        clearTimeout(hideTimeout)
        hideTimeout = null
      }
      // For quick edit, also mark as added
      markSelectionAsAddedToChat()

      // Reset flag after a short delay
      setTimeout(() => {
        justAddedToChat = false
      }, 200)
    }
  })

  function showSelectionMenu(x: number, y: number) {
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }

    // Position the menu above and to the right of the selection end
    const menuWidth = 280
    const menuHeight = 40
    const padding = 8

    // Adjust position to stay within viewport
    let menuX = x + 5
    let menuY = y - menuHeight - padding

    // Check right boundary
    if (menuX + menuWidth > window.innerWidth) {
      menuX = window.innerWidth - menuWidth - padding
    }

    // Check top boundary - if menu would go above viewport, show below
    if (menuY < padding) {
      menuY = y + padding
    }

    menu.style.left = `${menuX}px`
    menu.style.top = `${menuY}px`
    menu.classList.add('visible')
  }

  function hideSelectionMenu() {
    if (hideTimeout) {
      clearTimeout(hideTimeout)
    }
    hideTimeout = setTimeout(() => {
      menu.classList.remove('visible')
      // Don't clear currentSelection here - keep it for marking as added
    }, 100)
  }

  /**
   * Mark the current selection as added to chat with a different color
   */
  function markSelectionAsAddedToChat() {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      return
    }

    const range = selection.getRangeAt(0)

    // Create a highlight element to preserve the visual selection
    const highlight = document.createElement('span')
    highlight.className = 'cline-selection-added-to-chat'

    try {
      // Try to surround the selection with our highlight span
      // This works if the selection doesn't split nodes
      range.surroundContents(highlight)

      // Clear the browser selection after a brief moment to show the highlight
      setTimeout(() => {
        selection.removeAllRanges()
        currentSelection = null
      }, 100)
    } catch (error) {
      // If surroundContents fails (selection splits nodes), use a different approach
      try {
        // Extract and wrap the contents
        const contents = range.extractContents()
        highlight.appendChild(contents)
        range.insertNode(highlight)

        // Clear the browser selection
        setTimeout(() => {
          selection.removeAllRanges()
          currentSelection = null
        }, 100)
      } catch (error2) {
        // If both methods fail, just clear the selection normally
        console.error('Failed to mark selection:', error2)
        selection.removeAllRanges()
        currentSelection = null
      }
    }
  }

  /**
   * Clear all selection highlights (when menu is cancelled)
   */
  function clearSelectionHighlights() {
    // Find all highlight spans and unwrap them
    const highlights = document.querySelectorAll('.cline-selection-added-to-chat')
    highlights.forEach((highlight) => {
      const parent = highlight.parentNode
      if (parent) {
        // Move all children out of the highlight span
        while (highlight.firstChild) {
          parent.insertBefore(highlight.firstChild, highlight)
        }
        // Remove the empty highlight span
        parent.removeChild(highlight)
        // Normalize the parent to merge adjacent text nodes
        parent.normalize()
      }
    })
  }

  // Make clearSelectionHighlights accessible globally for message handler
  ;(window as any).clearSelectionHighlights = clearSelectionHighlights
}

/**
 * Build (or reuse) a line overlay that mirrors the source lines 1:1.
 * This avoids fuzzy block matching and keeps decorations scoped to exact lines.
 */
function buildLineOverlay(irContainer: Element): HTMLElement {
  let overlay = irContainer.querySelector<HTMLElement>('#cline-line-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'cline-line-overlay'
    overlay.style.position = 'absolute'
    overlay.style.top = '0'
    overlay.style.left = '0'
    overlay.style.right = '0'
    overlay.style.pointerEvents = 'none'
    overlay.style.zIndex = '3'
    overlay.style.whiteSpace = 'pre'
    irContainer.appendChild(overlay)
  }
  return overlay
}

function renderOverlayLines(overlay: HTMLElement, lines: string[], lineHeightPx: number) {
  overlay.innerHTML = ''
  const frag = document.createDocumentFragment()
  lines.forEach((line, i) => {
    const div = document.createElement('div')
    div.className = 'cline-line'
    div.dataset.line = String(i)
    div.style.height = `${lineHeightPx}px`
    // We don't render text to avoid overlaying the markdown; we only need the block for background/border
    div.textContent = ''
    div.style.width = '100%'
    div.style.pointerEvents = 'none'
    frag.appendChild(div)
  })
  overlay.appendChild(frag)
}

function applyLineDecorations(
  overlay: HTMLElement,
  decorations: { added: number[]; deleted: number[]; modified: number[] },
) {
  const { added, deleted, modified } = decorations
  const touched = new Set([...added, ...deleted, ...modified])
  touched.forEach((n) => {
    const el = overlay.querySelector<HTMLElement>(`.cline-line[data-line="${n}"]`)
    if (!el) return
    if (added.includes(n)) el.classList.add('cline-added-line')
    if (deleted.includes(n)) el.classList.add('cline-deleted-line')
    if (modified.includes(n)) el.classList.add('cline-modified-line')
  })
}

// Store the previous mode before switching to IR for decorations
let previousMode: 'wysiwyg' | 'ir' | 'sv' | null = null

/**
 * Apply decorations to Vditor with line-accurate rendering in IR mode.
 * Switches to IR mode if not already in it, applies decorations to exact line numbers,
 * and restores the previous mode when decorations are cleared.
 */
function applyDecorationsToVditor(
  decorations: { added: number[]; deleted: number[]; modified: number[] },
  retry: number = 0,
) {
  if (!window.vditor || !decorations) {
    return
  }

  clearDecorations()

  // Store current mode if we haven't already
  if (previousMode === null) {
    // Vditor is already in IR mode by default, but we should check
    const currentMode = (window.vditor as any).vditor?.currentMode || 'ir'
    previousMode = currentMode as 'wysiwyg' | 'ir' | 'sv'
  }

  // Ensure we're in IR mode for accurate line-by-line decorations
  // Vditor is already initialized in IR mode, but we ensure it stays that way
  setTimeout(() => {
    const irContainer = document.querySelector('.vditor-ir') as HTMLElement | null
    if (!irContainer || !window.vditor) {
      if (retry < 5) {
        setTimeout(() => applyDecorationsToVditor(decorations, retry + 1), 200)
      }
      return
    }

    const sourceMarkdown = window.vditor.getValue()
    const lines = sourceMarkdown.split('\n')
    const touched = new Set([...decorations.added, ...decorations.deleted, ...decorations.modified])

    // Build accurate line-to-element mapping
    // Strategy: Match source lines to rendered elements by finding elements that contain
    // the text from each source line, using multiple matching strategies for accuracy

    // Get all block-level elements in the IR view
    const allBlockElements = Array.from(irContainer.querySelectorAll(
      'p, div.vditor-ir__node, h1, h2, h3, h4, h5, h6, li, pre, blockquote, td, th, .vditor-ir__block'
    )) as HTMLElement[]

    // Build line-to-element mapping using multiple strategies
    const lineToElementMap = new Map<number, HTMLElement>()
    const usedElements = new Set<HTMLElement>()

    // Strategy 1: Exact text matching - find elements that contain the exact line text
    lines.forEach((line, lineIndex) => {
      if (line.trim()) {
        const lineText = line.trim()
        // Try to find an element that contains this exact line
        for (const el of allBlockElements) {
          if (usedElements.has(el)) continue

          const elText = el.textContent || ''
          const normalizedElText = elText.replace(/\s+/g, ' ').trim()
          const normalizedLineText = lineText.replace(/\s+/g, ' ').trim()

          // Exact match or line is contained in element
          if (normalizedElText === normalizedLineText ||
              normalizedElText.includes(normalizedLineText) ||
              (normalizedLineText.length > 20 && normalizedElText.includes(normalizedLineText.substring(0, 20)))) {
            lineToElementMap.set(lineIndex, el)
            usedElements.add(el)
            break
          }
        }
      }
    })

    // Strategy 2: For unmatched lines, use positional matching
    // Calculate character positions in source
    let sourceCharPos = 0
    const lineStartPositions = lines.map(line => {
      const pos = sourceCharPos
      sourceCharPos += line.length + 1 // +1 for newline
      return pos
    })

    // Build a rough mapping based on text content order
    let elementIndex = 0
    lines.forEach((line, lineIndex) => {
      if (!lineToElementMap.has(lineIndex) && line.trim() && elementIndex < allBlockElements.length) {
        // Try to match by position in the document
        const lineText = line.trim()
        for (let i = elementIndex; i < allBlockElements.length; i++) {
          const el = allBlockElements[i]
          if (usedElements.has(el)) continue

          const elText = (el.textContent || '').trim()
          // Check if this element could correspond to this line
          if (elText && (elText.includes(lineText.substring(0, Math.min(15, lineText.length))) ||
                         lineText.includes(elText.substring(0, Math.min(15, elText.length))))) {
            lineToElementMap.set(lineIndex, el)
            usedElements.add(el)
            elementIndex = i + 1
            break
          }
        }
      }
    })

    // Strategy 3: For empty lines or still unmatched, use proximity
    lines.forEach((line, lineIndex) => {
      if (!lineToElementMap.has(lineIndex)) {
        // Find the closest matched element before and after
        let beforeElement: HTMLElement | null = null
        let afterElement: HTMLElement | null = null

        for (let i = lineIndex - 1; i >= 0; i--) {
          const el = lineToElementMap.get(i)
          if (el) {
            beforeElement = el
            break
          }
        }

        for (let i = lineIndex + 1; i < lines.length; i++) {
          const el = lineToElementMap.get(i)
          if (el) {
            afterElement = el
            break
          }
        }

        // Use the before element if available, otherwise after
        if (beforeElement) {
          lineToElementMap.set(lineIndex, beforeElement)
        } else if (afterElement) {
          lineToElementMap.set(lineIndex, afterElement)
        }
      }
    })

    // Apply decorations to specific lines
    const applyDecorationToLine = (lineNum: number, className: string) => {
      if (lineNum < 0 || lineNum >= lines.length) {
        return
      }

      const element = lineToElementMap.get(lineNum)

      if (element) {
        element.classList.add(className)
        // Ensure visibility by also applying to parent if it's a container
        const parent = element.parentElement
        if (parent && parent !== irContainer && parent.classList.contains('vditor-ir__node')) {
          parent.classList.add(className)
        }
      } else {
        // Last resort: try to find by text content
        const lineText = lines[lineNum].trim()
        if (lineText) {
          const allElements = Array.from(irContainer.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, pre, blockquote, .vditor-ir__node')) as HTMLElement[]
          const found = allElements.find(el => {
            const elText = el.textContent || ''
            return elText.includes(lineText) || (lineText.length > 15 && elText.includes(lineText.substring(0, 15)))
          })
          if (found) {
            found.classList.add(className)
          }
        }
      }
    }

    // Apply decorations
    decorations.added.forEach((n) => applyDecorationToLine(n, 'cline-added-line'))
    decorations.deleted.forEach((n) => applyDecorationToLine(n, 'cline-deleted-line'))
    decorations.modified.forEach((n) => applyDecorationToLine(n, 'cline-modified-line'))

    if (touched.size > 0) {
      showFloatingToolbar()
    }
  }, 200)
}

/**
 * Clear all decoration classes and overlays
 * Restores the previous editing mode if it was changed for decorations
 */
function clearDecorations() {
  if (!window.vditor) {
    return
  }

  const irContainer = document.querySelector('.vditor-ir')
  if (!irContainer) {
    return
  }

  irContainer.querySelectorAll('.cline-added-line, .cline-deleted-line, .cline-modified-line').forEach((el) => {
    el.classList.remove('cline-added-line', 'cline-deleted-line', 'cline-modified-line')
  })

  // Restore previous mode if we switched to IR mode for decorations
  // Note: Vditor is already in IR mode by default, so we don't need to restore
  // But we reset the previousMode flag
  previousMode = null

  hideFloatingToolbar()
}

/**
 * Create and show the floating toolbar with Undo/Keep buttons
 */
function createFloatingToolbar() {
  // Remove existing toolbar if any
  const existing = document.getElementById('cline-floating-toolbar')
  if (existing) {
    existing.remove()
  }

  const toolbar = document.createElement('div')
  toolbar.id = 'cline-floating-toolbar'
  toolbar.className = 'cline-floating-toolbar'
  toolbar.innerHTML = `
    <button class="cline-toolbar-btn undo" id="cline-undo-btn">
      Undo All
      <span class="cline-toolbar-shortcut">⌥⌘N</span>
    </button>
    <button class="cline-toolbar-btn keep" id="cline-keep-btn">
      Keep All
      <span class="cline-toolbar-shortcut">⌥⌘Y</span>
    </button>
  `

  document.body.appendChild(toolbar)

  // Add click handlers
  document.getElementById('cline-undo-btn')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'cline-undo-changes' })
  })

  document.getElementById('cline-keep-btn')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'cline-keep-changes' })
  })

  return toolbar
}

/**
 * Show the floating toolbar
 */
function showFloatingToolbar() {
  let toolbar = document.getElementById('cline-floating-toolbar')
  if (!toolbar) {
    toolbar = createFloatingToolbar()
  }
  toolbar.classList.add('visible')
  console.log('[MarkdownEditor] Showing floating toolbar')
}

/**
 * Hide the floating toolbar
 */
function hideFloatingToolbar() {
  const toolbar = document.getElementById('cline-floating-toolbar')
  if (toolbar) {
    toolbar.classList.remove('visible')
  }
  console.log('[MarkdownEditor] Hiding floating toolbar')
}

// Make renderPageBreaks globally accessible
;(window as any).renderPageBreaks = renderPageBreaks

vscode.postMessage({ command: 'ready' })
