/**
 * Utility functions for script detection and text direction determination.
 */

// Regex covering Arabic/Urdu script ranges (Urdu, Arabic, Persian, Pashto, Sindhi)
// and other RTL scripts (Hebrew, Syriac, Thaana, NKo, etc.)
const RTL_REGEX = /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
const LTR_REGEX = /[\u0041-\u005A\u0061-\u007A\u00C0-\u024F\u0900-\u0D7F]/;

/**
 * Detects whether a text string contains Urdu / RTL script characters.
 * Strips leading question numbers/prefixes like "Q1." before classifying script direction.
 */
export function detectScriptDirection(text?: string | null): 'rtl' | 'ltr' {
    if (!text) return 'ltr';
    const cleanText = text.replace(/^(Q\d+[\.\:\s]*|\d+[\.\:\s]*)/i, '');
    if (RTL_REGEX.test(cleanText)) {
        return 'rtl';
    }
    for (const char of cleanText) {
        if (LTR_REGEX.test(char)) {
            return 'ltr';
        }
    }
    return 'ltr';
}
