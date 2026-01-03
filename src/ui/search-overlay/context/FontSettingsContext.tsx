/**
 * AI Bookmark Brain - Font Settings Context
 * Provides font size configuration to all UI components via CSS variables
 */

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import type { FontSettings } from '../../../lib/storage';
import { uiSettings, DEFAULT_FONT_SIZES } from '../../../lib/storage';

export interface FontSettingsContextValue {
    fontSizes: FontSettings;
    cssVariables: React.CSSProperties;
    isLoading: boolean;
}

const FontSettingsContext = createContext<FontSettingsContextValue | null>(null);

/**
 * Convert FontSettings to CSS custom properties
 * Uses relative line-heights for automatic scaling
 */
function fontSizesToCssVariables(fontSizes: FontSettings): React.CSSProperties {
    return {
        '--font-search-input': `${fontSizes.searchInput}px`,
        '--font-result-title': `${fontSizes.resultTitle}px`,
        '--font-result-url': `${fontSizes.resultUrl}px`,
        '--font-result-badge': `${fontSizes.resultBadge}px`,
        '--font-summary-title': `${fontSizes.summaryTitle}px`,
        '--font-summary-text': `${fontSizes.summaryText}px`,
        '--font-summary-label': `${fontSizes.summaryLabel}px`,
        '--font-metadata-text': `${fontSizes.metadataText}px`,
    } as React.CSSProperties;
}

interface FontSettingsProviderProps {
    children: React.ReactNode;
}

export function FontSettingsProvider({ children }: FontSettingsProviderProps) {
    const [fontSizes, setFontSizes] = useState<FontSettings>(DEFAULT_FONT_SIZES);
    const [isLoading, setIsLoading] = useState(true);

    // Load font settings from storage on mount
    useEffect(() => {
        async function loadSettings() {
            try {
                const settings = await uiSettings.getValue();
                if (settings?.fontSizes) {
                    setFontSizes(settings.fontSizes);
                }
            } catch (error) {
                console.error('Failed to load font settings:', error);
            } finally {
                setIsLoading(false);
            }
        }
        loadSettings();

        // Listen for storage changes
        const unwatch = uiSettings.watch((newSettings) => {
            if (newSettings?.fontSizes) {
                setFontSizes(newSettings.fontSizes);
            }
        });

        return () => {
            unwatch();
        };
    }, []);

    // Memoize CSS variables to avoid recalculation
    const cssVariables = useMemo(
        () => fontSizesToCssVariables(fontSizes),
        [fontSizes]
    );

    const value: FontSettingsContextValue = {
        fontSizes,
        cssVariables,
        isLoading,
    };

    return (
        <FontSettingsContext.Provider value={value}>
            {children}
        </FontSettingsContext.Provider>
    );
}

/**
 * Hook to access font settings in components
 */
export function useFontSettings(): FontSettingsContextValue {
    const context = useContext(FontSettingsContext);
    if (!context) {
        // Return defaults if used outside provider
        return {
            fontSizes: DEFAULT_FONT_SIZES,
            cssVariables: fontSizesToCssVariables(DEFAULT_FONT_SIZES),
            isLoading: false,
        };
    }
    return context;
}
