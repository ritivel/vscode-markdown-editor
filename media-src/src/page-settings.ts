import { t } from './lang'
import { confirm } from './utils'

export type PageSize = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | 'Tabloid'

export interface PageSettings {
  pageSize?: PageSize
  header?: string
  footer?: string
  pageNumbers?: 'none' | 'left' | 'center' | 'right'
}

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): { frontmatter: PageSettings; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const yamlContent = match[1]
  const body = match[2]

  const frontmatter: PageSettings = {}
  const lines = yamlContent.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue

    const key = trimmed.substring(0, colonIndex).trim()
    let value = trimmed.substring(colonIndex + 1).trim()

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (key === 'pageSize') {
      if (['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'].includes(value)) {
        frontmatter.pageSize = value as PageSettings['pageSize']
      }
    } else if (key === 'header') {
      frontmatter.header = value
    } else if (key === 'footer') {
      frontmatter.footer = value
    } else if (key === 'pageNumbers') {
      if (['none', 'left', 'center', 'right'].includes(value)) {
        frontmatter.pageNumbers = value as PageSettings['pageNumbers']
      }
    }
  }

  return { frontmatter, body }
}

/**
 * Generate YAML frontmatter string from settings
 */
export function generateFrontmatter(settings: PageSettings): string {
  const lines: string[] = []

  if (settings.pageSize !== undefined) {
    lines.push(`pageSize: "${settings.pageSize}"`)
  }
  if (settings.header !== undefined) {
    lines.push(`header: "${settings.header.replace(/"/g, '\\"')}"`)
  }
  if (settings.footer !== undefined) {
    lines.push(`footer: "${settings.footer.replace(/"/g, '\\"')}"`)
  }
  if (settings.pageNumbers !== undefined) {
    lines.push(`pageNumbers: "${settings.pageNumbers}"`)
  }

  if (lines.length === 0) {
    return ''
  }

  return `---\n${lines.join('\n')}\n---\n\n`
}

/**
 * Update frontmatter in markdown content
 */
export function updateFrontmatter(content: string, settings: PageSettings): string {
  const { frontmatter: existing, body } = parseFrontmatter(content)

  // Merge with existing settings, only update provided values
  const merged: PageSettings = {
    ...existing,
    ...settings,
  }

  // Remove undefined values
  if (merged.pageSize === undefined) delete merged.pageSize
  if (merged.header === undefined) delete merged.header
  if (merged.footer === undefined) delete merged.footer
  if (merged.pageNumbers === undefined) delete merged.pageNumbers

  const newFrontmatter = generateFrontmatter(merged)

  // If no frontmatter needed and none exists, return as-is
  if (!newFrontmatter && !content.match(/^---\s*\n/)) {
    return content
  }

  return newFrontmatter + body
}

/**
 * Show page settings dialog
 */
export function showPageSettingsDialog(
  currentSettings: PageSettings,
  onApply: (settings: PageSettings) => void
): void {
  // Create dialog HTML
  const dialogHtml = `
    <div id="page-settings-dialog" class="page-settings-dialog-overlay">
      <div class="page-settings-dialog">
        <div class="page-settings-dialog-header">
          <h3>${t('pageSettings')}</h3>
        </div>
        <div class="page-settings-dialog-body">
          <div class="page-settings-field">
            <label for="page-settings-page-size">${t('pageSize')}</label>
            <select id="page-settings-page-size">
              <option value="A4" ${currentSettings.pageSize === 'A4' || !currentSettings.pageSize ? 'selected' : ''}>A4 (210 × 297 mm)</option>
              <option value="A3" ${currentSettings.pageSize === 'A3' ? 'selected' : ''}>A3 (297 × 420 mm)</option>
              <option value="A5" ${currentSettings.pageSize === 'A5' ? 'selected' : ''}>A5 (148 × 210 mm)</option>
              <option value="Letter" ${currentSettings.pageSize === 'Letter' ? 'selected' : ''}>Letter (8.5 × 11 in)</option>
              <option value="Legal" ${currentSettings.pageSize === 'Legal' ? 'selected' : ''}>Legal (8.5 × 14 in)</option>
              <option value="Tabloid" ${currentSettings.pageSize === 'Tabloid' ? 'selected' : ''}>Tabloid (11 × 17 in)</option>
            </select>
          </div>
          <div class="page-settings-field">
            <label for="page-settings-header">${t('header')}</label>
            <input type="text" id="page-settings-header" value="${(currentSettings.header || '').replace(/"/g, '&quot;')}" placeholder="Document title">
          </div>
          <div class="page-settings-field">
            <label for="page-settings-footer">${t('footer')}</label>
            <input type="text" id="page-settings-footer" value="${(currentSettings.footer || '').replace(/"/g, '&quot;')}" placeholder="Footer text">
          </div>
          <div class="page-settings-field">
            <label for="page-settings-page-numbers">${t('pageNumberPosition')}</label>
            <select id="page-settings-page-numbers">
              <option value="none" ${currentSettings.pageNumbers === 'none' ? 'selected' : ''}>${t('none')}</option>
              <option value="left" ${currentSettings.pageNumbers === 'left' ? 'selected' : ''}>${t('left')}</option>
              <option value="center" ${currentSettings.pageNumbers === 'center' ? 'selected' : ''}>${t('center')}</option>
              <option value="right" ${currentSettings.pageNumbers === 'right' ? 'selected' : ''}>${t('right')}</option>
            </select>
          </div>
        </div>
        <div class="page-settings-dialog-footer">
          <button class="page-settings-btn page-settings-btn-cancel" id="page-settings-cancel">${t('cancel')}</button>
          <button class="page-settings-btn page-settings-btn-apply" id="page-settings-apply">${t('apply')}</button>
        </div>
      </div>
    </div>
  `

  // Remove existing dialog if any
  const existing = document.getElementById('page-settings-dialog')
  if (existing) {
    existing.remove()
  }

  // Add dialog to body
  document.body.insertAdjacentHTML('beforeend', dialogHtml)

  const dialog = document.getElementById('page-settings-dialog')!
  const overlay = dialog as HTMLElement

  // Show dialog with animation
  setTimeout(() => {
    overlay.classList.add('visible')
  }, 10)

  // Handle apply button
  document.getElementById('page-settings-apply')?.addEventListener('click', () => {
    const pageSizeSelect = document.getElementById('page-settings-page-size') as HTMLSelectElement
    const headerInput = document.getElementById('page-settings-header') as HTMLInputElement
    const footerInput = document.getElementById('page-settings-footer') as HTMLInputElement
    const pageNumbersSelect = document.getElementById('page-settings-page-numbers') as HTMLSelectElement

    const settings: PageSettings = {
      pageSize: pageSizeSelect.value as PageSettings['pageSize'],
      header: headerInput.value.trim() || undefined,
      footer: footerInput.value.trim() || undefined,
      pageNumbers: pageNumbersSelect.value as PageSettings['pageNumbers'],
    }

    // Remove empty values
    if (!settings.header) delete settings.header
    if (!settings.footer) delete settings.footer
    if (settings.pageNumbers === 'none') {
      delete settings.pageNumbers
    }

    onApply(settings)
    closeDialog()
  })

  // Handle cancel button
  document.getElementById('page-settings-cancel')?.addEventListener('click', () => {
    closeDialog()
  })

  // Handle escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeDialog()
      document.removeEventListener('keydown', handleEscape)
    }
  }
  document.addEventListener('keydown', handleEscape)

  // Handle click outside
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeDialog()
    }
  })

  function closeDialog() {
    overlay.classList.remove('visible')
    setTimeout(() => {
      dialog.remove()
      document.removeEventListener('keydown', handleEscape)
    }, 200)
  }
}

