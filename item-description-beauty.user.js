// ==UserScript==
// @name         DOTV Item Description (Beauty)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @license      MIT
// @description  Enhanced tooltips with customizable colors and width settings; per-unit, conditional, distinct item tracking; item drop-location lookup
// @author       Zaregoto_Gaming
// @match        https://*.dragonsofthevoid.com/*
// @match        https://play.dragonsofthevoid.com/*
// @exclude      https://play.dragonsofthevoid.com/#/login
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      raw.githubusercontent.com
// @downloadURL  https://raw.githubusercontent.com/Liamcedric/dotv-item-description-beauty/main/item-description-beauty.user.js
// @updateURL    https://raw.githubusercontent.com/Liamcedric/dotv-item-description-beauty/main/item-description-beauty.user.js
// ==/UserScript==
(function () {
    'use strict';
    // ============ CONFIG: EASILY EDITABLE ============
    // User-configurable multipliers for damage calculations
    let amountWorn = parseInt(localStorage.getItem("tooltipAmountWorn")) || 8;
    // Unified storage for all "per X" item/unit counts (covers distinct, per-unit owned, per-unit formation, etc)
    // e.g., {"Formation": 20, "Ring": 10, "Heroic Dusk set item": 8, "Gipantan Poser": 3}
    const perItemStorage = JSON.parse(localStorage.getItem("tooltipPerItem")) || {};
    // Storage for conditional items (e.g., "Frostblossom Seed": true/false)
    const conditionalItemsStorage = JSON.parse(localStorage.getItem("tooltipConditionalItems")) || {};
    // ============ COLOR CONFIGURATION (User-customizable) ============
    const defaultColors = {
        // Regular items
        itemNameHighlight: '#FFB752',      // Item name glow color
        tierMainEffect: '#ffce73',         // Primary tier effect color (set bonus proc)
        tierSubEffect: '#D4AF37',          // Secondary/sub-effect color (set bonus sub-proc)
        setBonusHeader: '#d35400',         // Set Bonus header color
        greenHeader: '#42bd3a',            // Green header color (effects, bonuses)
        blueAccent: '#1e90ff',             // Blue accent (set bonus total)
        redAccent: '#d73219',              // Red accent (proc average)
        // Magic items
        magicProcName: '#FFB752',          // Magic item proc name glow
        magicItemProc: '#42bd3a',          // Magic item main proc (green)
        magicItemSubProc: '#ffce73',       // Magic item sub-effects (yellow bullets)
        magicHealingDamage: '#dc143c'      // Healing & damage resist color (crimson)
    };
    // Load user-saved colors or use defaults
    const userColors = (() => {
        const saved = localStorage.getItem('tooltipColors');
        return saved ? { ...defaultColors, ...JSON.parse(saved) } : defaultColors;
    })();
    function saveUserColors() {
        localStorage.setItem('tooltipColors', JSON.stringify(userColors));
    }
    function saveMultipliers() {
        localStorage.setItem("tooltipAmountWorn", amountWorn);
        localStorage.setItem("tooltipPerItem", JSON.stringify(perItemStorage));
        localStorage.setItem("tooltipConditionalItems", JSON.stringify(conditionalItemsStorage));
    }
    // ============ ITEM LOCATION LOOKUP ============
    const ITEM_LOCATIONS_URL = 'https://raw.githubusercontent.com/Liamcedric/dotv-item-description-beauty/main/data/item-locations.json';
    const ITEM_LOCATIONS_CACHE_KEY = 'itemLocationsCacheV1';
    const ITEM_LOCATIONS_CACHE_TIME_KEY = 'itemLocationsCacheTimeV1';
    const ITEM_LOCATIONS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
    let itemLocationIndex = null;
    function slugifyItemName(name) {
        return name
            .toLowerCase()
            .replace(/'/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
    function buildItemLocationIndex(json) {
        // Keys look like "e.lumina-flash-armor" - the prefix is an internal
        // category code, the item's display name always slugifies to the part after the dot.
        const index = new Map();
        for (const key of Object.keys(json)) {
            const dotIndex = key.indexOf('.');
            if (dotIndex === -1) continue;
            index.set(key.substring(dotIndex + 1), json[key]);
        }
        return index;
    }
    function fetchItemLocationsJson() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: ITEM_LOCATIONS_URL,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        try {
                            resolve(JSON.parse(res.responseText));
                        } catch (e) {
                            reject(e);
                        }
                    } else {
                        reject(new Error('HTTP ' + res.status));
                    }
                },
                onerror: reject,
                ontimeout: reject
            });
        });
    }
    async function initItemLocations() {
        const cachedRaw = GM_getValue(ITEM_LOCATIONS_CACHE_KEY, null);
        const cachedTime = GM_getValue(ITEM_LOCATIONS_CACHE_TIME_KEY, 0);
        const isFresh = cachedRaw && (Date.now() - cachedTime < ITEM_LOCATIONS_CACHE_TTL);
        if (isFresh) {
            try {
                itemLocationIndex = buildItemLocationIndex(JSON.parse(cachedRaw));
                return;
            } catch (e) {
                // Cache is corrupt - fall through to a fresh fetch
            }
        }
        try {
            const json = await fetchItemLocationsJson();
            GM_setValue(ITEM_LOCATIONS_CACHE_KEY, JSON.stringify(json));
            GM_setValue(ITEM_LOCATIONS_CACHE_TIME_KEY, Date.now());
            itemLocationIndex = buildItemLocationIndex(json);
        } catch (e) {
            console.warn('DOTV Item Description: failed to fetch item location data', e);
            if (cachedRaw) {
                try {
                    itemLocationIndex = buildItemLocationIndex(JSON.parse(cachedRaw));
                } catch (e2) {
                    // No usable data available - location buttons simply won't appear
                }
            }
        }
    }
    initItemLocations();
    function findItemLocation(itemName) {
        if (!itemLocationIndex || !itemName) return null;
        const entry = itemLocationIndex.get(slugifyItemName(itemName));
        if (!entry || !entry.locationText) return null;
        return entry;
    }
    function getItemNameFromPopover(popover) {
        const nameSpan = popover.querySelector('.item-popover-head-details .item-name');
        if (nameSpan) return nameSpan.textContent.trim();
        // Magic item cards have no separate name element - the name is the
        // first line of the card text, before the colon.
        const detailSpan = popover.querySelector('.item-popover-head-details span');
        if (detailSpan) {
            const text = detailSpan.innerText || detailSpan.textContent || '';
            const firstLine = text.split(/[\r\n;]/)[0];
            const colonIndex = firstLine.indexOf(':');
            return (colonIndex !== -1 ? firstLine.substring(0, colonIndex) : firstLine).trim();
        }
        return null;
    }
    function openLocationModal(itemName, entry) {
        if (document.getElementById('itemLocationModal')) return;
        const backdrop = document.createElement('div');
        backdrop.id = 'itemLocationModalBackdrop';
        backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;';
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                backdrop.remove();
                modal.remove();
            }
        });
        const modal = document.createElement('div');
        modal.id = 'itemLocationModal';
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1410;border:2px solid #6b5344;border-radius:8px;padding:20px;z-index:10001;max-width:500px;width:90vw;max-height:80vh;overflow:auto;';
        const title = document.createElement('h2');
        title.style.cssText = 'color:#FFB752;margin:0 0 12px 0;font-size:18px;text-align:center;text-shadow:0 0 8px rgba(255,255,255,0.5);';
        title.textContent = itemName;
        modal.appendChild(title);
        const body = document.createElement('div');
        body.style.cssText = 'color:#d4af37;font-size:13px;white-space:pre-wrap;line-height:1.5;';
        body.textContent = entry.locationText;
        modal.appendChild(body);
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'display:block;margin:16px auto 0;padding:8px 20px;background:#FFB752;border:none;color:#1a1410;border-radius:4px;cursor:pointer;font-weight:bold;';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', () => {
            backdrop.remove();
            modal.remove();
        });
        modal.appendChild(closeBtn);
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
    }
    function injectLocationButton(itemPopover) {
        if (!itemPopover || itemPopover.dataset.locationInjected) return;
        const itemName = getItemNameFromPopover(itemPopover);
        const entry = findItemLocation(itemName);
        if (!entry) return;
        itemPopover.dataset.locationInjected = 'true';
        const itemHead = itemPopover.querySelector('.item-popover-head');
        if (!itemHead || itemHead.querySelector('.tooltip-location-icon')) return;
        const locationBtn = document.createElement('button');
        locationBtn.className = 'tooltip-location-icon';
        locationBtn.style.cssText = 'position:absolute;top:8px;right:36px;background:none;border:none;color:#a0725f;cursor:pointer;font-size:16px;padding:4px;transition:color 0.2s;z-index:100;';
        locationBtn.textContent = '📍';
        locationBtn.title = 'Item Location';
        locationBtn.addEventListener('click', () => openLocationModal(itemName, entry));
        locationBtn.addEventListener('mouseenter', () => locationBtn.style.color = '#FFB752');
        locationBtn.addEventListener('mouseleave', () => locationBtn.style.color = '#a0725f');
        itemPopover.style.position = 'relative';
        itemPopover.appendChild(locationBtn);
    }
    function openImageZoom(imgElement) {
        // Prevent opening if already open
        if (document.getElementById('imageZoomModal')) return;
        const imageSrc = imgElement.src;
        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'imageZoomBackdrop';
        backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:9999;cursor:pointer;';
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                backdrop.remove();
                modal.remove();
            }
        });
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'imageZoomModal';
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;background:#1a1410;border:2px solid #6b5344;border-radius:8px;padding:20px;max-width:90vw;max-height:90vh;display:flex;flex-direction:column;align-items:center;box-shadow:0 0 20px rgba(0,0,0,0.8);';
        // Close button at top-right (half off corner)
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'position:absolute;top:-10px;right:-10px;background:none;border:none;cursor:pointer;padding:0;width:36px;height:36px;display:flex;align-items:center;justify-content:center;z-index:10001;';
        closeBtn.title = 'Close';
        // Use game's exit button image
        const closeImg = document.createElement('img');
        closeImg.src = 'https://files.dragonsofthevoid.com/ui/buttons/exit-button.jpg';
        closeImg.className = 'button';
        closeImg.style.cssText = 'height:20px;width:20px;';
        closeBtn.appendChild(closeImg);
        closeBtn.addEventListener('click', () => {
            backdrop.remove();
            modal.remove();
        });
        closeBtn.addEventListener('mouseenter', () => closeImg.style.opacity = '0.7');
        closeBtn.addEventListener('mouseleave', () => closeImg.style.opacity = '1');
        // Display image
        const imgContainer = document.createElement('div');
        imgContainer.style.cssText = 'display:flex;align-items:center;justify-content:center;max-width:100%;max-height:calc(90vh - 60px);overflow:auto;';
        const img = document.createElement('img');
        img.src = imageSrc;
        img.style.cssText = 'max-width:100%;max-height:100%;image-rendering:pixelated;border:1px solid #6b5344;border-radius:4px;';
        imgContainer.appendChild(img);
        modal.appendChild(closeBtn);
        modal.appendChild(imgContainer);
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
    }
    function injectImageZoom() {
        // Find all item images and add click handlers
        document.querySelectorAll('.item-popover-image-container img').forEach(img => {
            if (!img.dataset.zoomInjected) {
                img.dataset.zoomInjected = 'true';
                img.style.cursor = 'pointer';
                img.style.transition = 'opacity 0.2s';
                img.addEventListener('click', () => openImageZoom(img));
                img.addEventListener('mouseenter', () => img.style.opacity = '0.8');
                img.addEventListener('mouseleave', () => img.style.opacity = '1');
            }
        });
    }
    function openColorSettings(sourcePopover = null, isMagicItem = false, magicCardSpan = null) {
        // Check if settings modal already exists
        let modal = document.getElementById('tooltipColorSettings');
        if (modal) {
            modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
            return;
        }
        // Prepare preview reference (available for all color pickers)
        let previewEffectsDiv = null;
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'tooltipColorSettingsBackdrop';
        backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;';
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                backdrop.remove();
                modal.remove();
            }
        });
        // Create modal
        modal = document.createElement('div');
        modal.id = 'tooltipColorSettings';
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1410;border:2px solid #6b5344;border-radius:8px;padding:20px;z-index:10001;max-width:90vw;max-height:90vh;overflow:auto;display:flex;gap:20px;';
        // LEFT PANEL: Color pickers
        const leftPanel = document.createElement('div');
        leftPanel.style.cssText = 'flex:0 0 350px;';
        const title = document.createElement('h2');
        title.style.cssText = 'color:#FFB752;text-align:center;margin:0 0 20px 0;font-size:18px;';
        title.textContent = isMagicItem ? 'Magic Item Color Settings' : 'Tooltip Color Settings';
        leftPanel.appendChild(title);
        // Add width adjustment controls (only for regular items, not magic)
        if (!isMagicItem) {
            const widthContainer = document.createElement('div');
            widthContainer.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:20px;padding:10px;background:rgba(107,83,68,0.3);border-radius:4px;';
            const widthLabel = document.createElement('span');
            widthLabel.style.cssText = 'color:#a0725f;font-size:12px;min-width:60px;';
            widthLabel.textContent = 'Width:';
            const widthDisplay = document.createElement('span');
            widthDisplay.style.cssText = 'color:#FFB752;font-size:14px;font-weight:bold;min-width:50px;text-align:center;';
            widthDisplay.textContent = `${tooltipWidth}px`;
            const minusBtn = document.createElement('button');
            minusBtn.textContent = '−';
            minusBtn.style.cssText = 'width:24px;height:24px;background:#3a2a1f;border:1px solid #6b5344;color:#a0725f;cursor:pointer;border-radius:3px;';
            minusBtn.addEventListener('click', () => {
                tooltipWidth = Math.max(200, tooltipWidth - 20);
                applyTooltipWidth(tooltipWidth);
                widthDisplay.textContent = `${tooltipWidth}px`;
                // Update preview width via wrapper
                if (previewEffectsDiv && previewEffectsDiv._wrapper) {
                    previewEffectsDiv._wrapper.style.width = `${tooltipWidth}px`;
                }
            });
            const plusBtn = document.createElement('button');
            plusBtn.textContent = '+';
            plusBtn.style.cssText = 'width:24px;height:24px;background:#3a2a1f;border:1px solid #6b5344;color:#a0725f;cursor:pointer;border-radius:3px;';
            plusBtn.addEventListener('click', () => {
                tooltipWidth += 20;
                applyTooltipWidth(tooltipWidth);
                widthDisplay.textContent = `${tooltipWidth}px`;
                // Update preview width via wrapper
                if (previewEffectsDiv && previewEffectsDiv._wrapper) {
                    previewEffectsDiv._wrapper.style.width = `${tooltipWidth}px`;
                }
            });
            widthContainer.appendChild(widthLabel);
            widthContainer.appendChild(minusBtn);
            widthContainer.appendChild(widthDisplay);
            widthContainer.appendChild(plusBtn);
            leftPanel.appendChild(widthContainer);
        }
        // Color settings - different for magic vs regular items
        const colorSettings = isMagicItem ? [
            { key: 'magicProcName', label: 'Proc Name (Highlighted)' },
            { key: 'magicItemProc', label: 'Item Proc' },
            { key: 'magicItemSubProc', label: 'Item Sub Proc' },
            { key: 'magicHealingDamage', label: 'Healing & DMG Resist' }
        ] : [
            { key: 'itemNameHighlight', label: 'Proc Name (Highlighted)' },
            { key: 'greenHeader', label: 'Item Proc' },
            { key: 'tierMainEffect', label: 'Item Sub Proc' },
            { key: 'setBonusHeader', label: 'Set Bonus Header' },
            { key: 'tierSubEffect', label: 'Set Bonus Sub Proc' },
            { key: 'blueAccent', label: 'Set Bonus AVG' },
            { key: 'redAccent', label: 'AVG Proc' }
        ];
        const colorInputs = {};
        for (const setting of colorSettings) {
            const container = document.createElement('div');
            container.style.cssText = 'margin-bottom:16px;';
            const label = document.createElement('label');
            label.style.cssText = 'display:block;color:#a0725f;font-size:12px;margin-bottom:6px;';
            label.textContent = setting.label;
            const colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.value = userColors[setting.key];
            colorPicker.style.cssText = 'width:100%;height:36px;border:1px solid #6b5344;border-radius:4px;cursor:pointer;';
            colorInputs[setting.key] = colorPicker;
            colorPicker.addEventListener('input', (e) => {
                const oldColor = userColors[setting.key];
                const newColor = e.target.value;
                userColors[setting.key] = newColor;
                // Live update preview with simple color swap
                if (previewEffectsDiv) {
                    updatePreviewColors(previewEffectsDiv, setting.key, oldColor, newColor);
                }
            });
            container.appendChild(label);
            container.appendChild(colorPicker);
            leftPanel.appendChild(container);
        }
        // Button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display:flex;gap:8px;margin-top:20px;';
        // Apply button
        const applyBtn = document.createElement('button');
        applyBtn.style.cssText = 'flex:1;padding:10px;background:#FFB752;border:none;color:#1a1410;border-radius:4px;cursor:pointer;font-weight:bold;';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', () => {
            saveUserColors();
            // Re-enhance all open item tooltips
            document.querySelectorAll('.effects[data-enhanced="true"]').forEach(div => {
                div.dataset.enhanced = '';
                enhanceEffectsDiv(div);
            });
            // Re-enhance all magic cards
            document.querySelectorAll('.item-popover-head-details span').forEach(span => {
                if (span.dataset.enhanced) {
                    span.dataset.enhanced = '';
                    enhanceMagicCardDiv(span);
                }
            });
            // Close modal
            backdrop.remove();
            modal.remove();
        });
        buttonContainer.appendChild(applyBtn);
        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.style.cssText = 'flex:1;padding:10px;background:#3a2a1f;border:1px solid #6b5344;color:#a0725f;border-radius:4px;cursor:pointer;';
        resetBtn.textContent = 'Reset';
        resetBtn.addEventListener('click', () => {
            Object.assign(userColors, defaultColors);
            for (const [key, input] of Object.entries(colorInputs)) {
                input.value = userColors[key];
            }
            // Regenerate preview with fresh clone
            if (previewEffectsDiv && sourcePopover) {
                const sourceDiv = sourcePopover.querySelector('.effects') || sourcePopover.querySelector('.item-popover-head-details span');
                if (sourceDiv) {
                    const newPreview = sourceDiv.cloneNode(true);
                    if (newPreview.classList.contains('effects')) {
                        // Create wrapper for regular items
                        const newWrapper = document.createElement('div');
                        newWrapper.style.cssText = `width:${tooltipWidth}px;box-sizing:border-box;`;
                        // Get computed font styles from source to match preview exactly
                        const sourceStyles = window.getComputedStyle(sourceDiv);
                        const fontCSS = `font-family:${sourceStyles.fontFamily};font-size:${sourceStyles.fontSize};font-weight:${sourceStyles.fontWeight};line-height:${sourceStyles.lineHeight};white-space:pre-wrap;`;
                        newPreview.style.cssText = fontCSS;
                        newWrapper.appendChild(newPreview);
                        previewEffectsDiv._wrapper.parentNode.replaceChild(newWrapper, previewEffectsDiv._wrapper);
                        previewEffectsDiv = newPreview;
                        previewEffectsDiv._wrapper = newWrapper;
                    } else {
                        // Magic items don't use wrapper
                        const sourceStyles = window.getComputedStyle(sourceDiv);
                        const fontCSS = `display:block;font-family:${sourceStyles.fontFamily};font-size:${sourceStyles.fontSize};font-weight:${sourceStyles.fontWeight};line-height:${sourceStyles.lineHeight};white-space:pre-wrap;`;
                        newPreview.style.cssText = fontCSS;
                        previewEffectsDiv.parentNode.replaceChild(newPreview, previewEffectsDiv);
                        previewEffectsDiv = newPreview;
                    }
                }
            }
        });
        buttonContainer.appendChild(resetBtn);
        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'flex:1;padding:10px;background:#3a2a1f;border:1px solid #6b5344;color:#a0725f;border-radius:4px;cursor:pointer;';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', () => {
            backdrop.remove();
            modal.remove();
        });
        buttonContainer.appendChild(closeBtn);
        leftPanel.appendChild(buttonContainer);
        modal.appendChild(leftPanel);
        // RIGHT PANEL: Live preview of the actual item
        if (sourcePopover) {
            const rightPanel = document.createElement('div');
            rightPanel.style.cssText = 'flex:1;min-width:300px;border:1px solid #6b5344;border-radius:4px;padding:12px;background:rgba(26,20,16,0.5);overflow-y:auto;max-height:calc(90vh - 80px);';
            const previewTitle = document.createElement('h3');
            previewTitle.style.cssText = 'color:#FFB752;margin:0 0 12px 0;font-size:14px;text-align:center;';
            previewTitle.textContent = 'Live Preview';
            rightPanel.appendChild(previewTitle);
            // Clone the correct div based on item type
            let sourceDiv;
            if (isMagicItem && magicCardSpan) {
                sourceDiv = magicCardSpan;
            } else if (isMagicItem) {
                sourceDiv = sourcePopover.querySelector('.item-popover-head-details span');
            } else {
                sourceDiv = sourcePopover.querySelector('.effects');
            }
            if (sourceDiv) {
                previewEffectsDiv = sourceDiv.cloneNode(true);
                if (isMagicItem) {
                    // Get computed font styles from source to match preview exactly
                    const sourceStyles = window.getComputedStyle(sourceDiv);
                    const fontCSS = `display:block;font-family:${sourceStyles.fontFamily};font-size:${sourceStyles.fontSize};font-weight:${sourceStyles.fontWeight};line-height:${sourceStyles.lineHeight};white-space:pre-wrap;`;
                    previewEffectsDiv.style.cssText = fontCSS;
                    rightPanel.appendChild(previewEffectsDiv);
                } else {
                    // Create a wrapper that mimics .item-popover-content to accurately show width
                    const contentWrapper = document.createElement('div');
                    contentWrapper.style.cssText = `width:${tooltipWidth}px;box-sizing:border-box;`;
                    // Get computed font styles from source to match preview exactly
                    const sourceStyles = window.getComputedStyle(sourceDiv);
                    const fontCSS = `font-family:${sourceStyles.fontFamily};font-size:${sourceStyles.fontSize};font-weight:${sourceStyles.fontWeight};line-height:${sourceStyles.lineHeight};white-space:pre-wrap;`;
                    previewEffectsDiv.style.cssText = fontCSS;
                    contentWrapper.appendChild(previewEffectsDiv);
                    rightPanel.appendChild(contentWrapper);
                    // Store reference to wrapper so we can update width later
                    previewEffectsDiv._wrapper = contentWrapper;
                }
            }
            modal.appendChild(rightPanel);
        }
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
    }
    function updatePreviewColors(previewDiv, colorKey, oldColor, newColor) {
        if (!previewDiv) return;
        // Simple hex color swap in the innerHTML
        previewDiv.innerHTML = previewDiv.innerHTML.replaceAll(oldColor, newColor);
    }
    function setDistinctItemCount(itemType, count) {
        // Legacy: now just calls unified setter
        setPerItemCount(itemType, count);
    }
    function hasConditionalItem(itemName) {
        // Default to true (owned) if not explicitly set to false
        const value = conditionalItemsStorage[itemName];
        return value !== false; // Returns true if undefined or true
    }
    function setConditionalItem(itemName, owned) {
        conditionalItemsStorage[itemName] = owned;
        saveMultipliers();
    }
    function getPerItemCount(itemName) {
        // Unified getter for ALL "per X" patterns (distinct, per-unit, per-formation, etc)
        return perItemStorage[itemName] || 8;
    }
    function setPerItemCount(itemName, count) {
        // Unified setter for ALL "per X" patterns
        perItemStorage[itemName] = count;
        saveMultipliers();
    }
    // Legacy functions for backward compatibility
    function getPerUnitCount(unitName) {
        return getPerItemCount(unitName);
    }
    function setPerUnit(unitName, count) {
        setPerItemCount(unitName, count);
    }
    function extractPerUnitName(line) {
        // Extract unit name from various per-unit patterns:
        // - "per [X] owned"
        // - "per [X] in the active Formation"
        // - "per [X] in the Formation"
        // - "per [X] and Formation owned"
        // - "per [X] or [Y] in the Formation"
        // Try "or" pattern first: "per [X] or [Y] in the Formation"
        let match = line.match(/per\s+(.+?)\s+or\s+.+?\s+in\s+the\s+(?:active\s+)?Formation/i);
        if (match) {
            return match[1].trim();
        }
        // Try other patterns: "per [X] (owned|in active Formation|in Formation|and Formation owned)"
        match = line.match(/per\s+(.+?)\s+(?:owned|in\s+the\s+(?:active\s+)?Formation|and\s+Formation\s+owned)/i);
        if (match) {
            // If multiple units comma-separated, just take the first one
            const units = match[1].split(',').map(u => u.trim());
            return units[0];
        }
        return null;
    }
    // ============ DAMAGE TYPES ============
    const DAMAGE_TYPES = [
        "Any", "Acid", "Dark", "Fire", "Holy", "Ice", "Lightning", "Nature",
        "Physical", "Poison", "Psychic", "Magic"
    ];
    // ============ PATTERN REGISTRY (Modular & Extensible) ============
    // Add new patterns here without touching core logic
    const DAMAGE_PATTERNS = [
        // ---- PROC PATTERNS (with % chance) ----
        {
            name: "proc_multi_damage",
            // "X% chance to proc [multiple damage types]"
            // E.g., "30% chance to proc 100 Fire and 100 Holy damage"
            // E.g., "25% chance to proc 50 Fire, 75 Ice, and 100 Lightning damage"
            // MUST have "and" or "," to avoid matching single-damage procs
            regex: /(\d+(?:\.\d+)?)\%\s*chance\s*to\s*proc\s+[\d,]+\s+\w+(?:\s+(?:and|,)\s+[\d,]+\s+\w+)+\s+damage/i,
            extract: (match) => {
                const procRate = parseFloat(match[1]) / 100;
                // Extract damage amounts and type names: "100 Fire and 100 Holy" → {100, Fire}, {100, Holy}
                const damageMatches = match[0].match(/(\d+(?:,\d+)*)\s+(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)/gi);
                const damages = damageMatches ? damageMatches.map(m => {
                    const [amountStr, type] = m.split(/\s+/);
                    return {
                        amount: parseInt(amountStr.replace(/,/g, ''), 10),
                        type: type.toLowerCase()
                    };
                }) : [];
                // Sum all damage amounts and unique types
                const totalBaseDamage = damages.reduce((sum, d) => sum + d.amount, 0);
                const uniqueTypes = [...new Set(damages.map(d => d.type))];
                return {
                    procRate,
                    damage: totalBaseDamage,  // 200 for "100 Fire and 100 Holy"
                    context: "proc_multi_damage",
                    damageTypeNames: uniqueTypes,
                    damageCount: uniqueTypes.length  // 2
                };
            }
        },
        {
            name: "proc_basic",
            // "X% chance to proc Y Fire damage"
            regex: /(\d+(?:\.\d+)?)\%\s*chance\s*to\s*proc\s+([\d,]+)\s+(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+damage/i,
            extract: (match) => ({
                procRate: parseFloat(match[1]) / 100,
                damage: parseInt(match[2].replace(/,/g, ""), 10),
                type: match[3].toLowerCase(),
                context: "proc"
            })
        },
        {
            name: "proc_vs_raid",
            // "X% chance to proc Y Fire damage vs Aquatic raids"
            regex: /(\d+(?:\.\d+)?)\%\s*chance\s*to\s*proc\s+([\d,]+)\s+(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+damage\s+vs\s+([\w\s]+?)(?:\s+raids?)?$/i,
            extract: (match) => ({
                procRate: parseFloat(match[1]) / 100,
                damage: parseInt(match[2].replace(/,/g, ""), 10),
                type: match[3].toLowerCase(),
                context: "proc_vs_raid",
                vsType: match[4].trim()
            })
        },
        {
            name: "proc_multiple_damage",
            // "X% chance to proc Y of each damage" or "X% chance to proc Y Fire, Z Ice damage"
            regex: /(\d+(?:\.\d+)?)\%\s*chance\s*to\s*proc\s+([\d,]+)\s+of\s+each\s+damage/i,
            extract: (match) => ({
                procRate: parseFloat(match[1]) / 100,
                damage: parseInt(match[2].replace(/,/g, ""), 10),
                damageCount: DAMAGE_TYPES.length, // count each damage type
                context: "proc_each"
            })
        },
        {
            name: "proc_vs_raid_each",
            // "X% chance to proc Y of each damage vs Aquatic raids"
            regex: /(\d+(?:\.\d+)?)\%\s*chance\s*to\s*proc\s+([\d,]+)\s+of\s+each\s+damage\s+vs\s+([\w\s]+?)(?:\s+raids?)?$/i,
            extract: (match) => ({
                procRate: parseFloat(match[1]) / 100,
                damage: parseInt(match[2].replace(/,/g, ""), 10),
                damageCount: DAMAGE_TYPES.length,
                context: "proc_each_vs_raid",
                vsType: match[3].trim()
            })
        },
        // ---- FLAT DAMAGE PATTERNS (no proc rate) ----
        {
            name: "flat_vs_raid",
            // "+Y Fire damage vs Aquatic raids" (also "+Y damage vs X" without element)
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+vs\s+([\w\s]+?)(?:\s+raids?)?$/i,
            extract: (match) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                context: "flat_vs_raid",
                vsType: match[3].trim()
            })
        },
        // ---- PER-UNIT/FORMATION PATTERNS (must come before SET BONUS patterns) ----
        {
            name: "per_unit_or_formation",
            // "+X damage per [Unit] or [Unit] in the Formation" - e.g., "per Baron Aureus' Footman or Baron Aureus' Medic in the Formation"
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+(.+?)\s+or\s+.+?\s+in\s+the\s+(?:active\s+)?Formation/i,
            extract: (match) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "per_unit",
                multiplier: 1,
                context: "per_unit_or_formation"
            })
        },
        {
            name: "per_unit_type_and_formation",
            // "+X damage per [Unit], [Type] and Formation owned" - e.g., "per Heroic Dusk set item, Magic and Formation owned"
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+(.+?),\s*(?:fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+and\s+Formation\s+owned/i,
            extract: (match) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "per_unit",
                multiplier: 1,
                context: "per_unit_type_and_formation"
            })
        },
        {
            name: "per_unit_and_formation",
            // "+X damage per [Unit] and Formation owned"
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+(.+?)\s+and\s+Formation\s+owned/i,
            extract: (match) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "per_unit",
                multiplier: 1,
                context: "per_unit_and_formation"
            })
        },
        {
            name: "per_unit_formation",
            // "+X damage per [Unit] in the active Formation"
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+(.+?)\s+in\s+the\s+active\s+Formation/i,
            extract: (match) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "per_unit",
                multiplier: 1,
                context: "per_unit_formation"
            })
        },
        {
            name: "per_unit_formation_simple",
            // "+X damage per [Unit] in the Formation" (without "active")
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+(?!distinct)(.+?)\s+in\s+the\s+Formation/i,
            extract: (match) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "per_unit",
                multiplier: 1,
                context: "per_unit_formation_simple"
            })
        },
        {
            name: "per_unit_owned",
            // "+X damage per [Unit] owned" - BUT NOT "per distinct X owned"
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+(?!distinct)(.+?)\s+owned/i,
            extract: (match) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "per_unit",
                multiplier: 1,
                context: "per_unit_owned"
            })
        },
        // ---- SET BONUS PATTERNS ----
        {
            name: "set_per_item_worn",
            // "+Y damage per X set item worn" (multiplied by worn count)
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+.+?\s+set\s+item\s+worn/i,
            extract: (match, setName, setCount) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "worn",  // ← Add this
                multiplier: setCount,
                context: "set_per_item_worn"
            })
        },
        {
            name: "set_per_item_owned",
            // "+Y damage per X set item ... owned" (handles "set item, Magic and Formation" etc)
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+.+?\s+set\s+item.+?owned/i,
            extract: (match, setName, setCount) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "owned",
                multiplier: setCount,
                context: "set_per_item_owned"
            })
        },
        {
            name: "set_per_item_each_worn",
            // "+Y of each damage per X set item worn"
            regex: /\+\s*([\d,]+)\s+of\s+each\s+damage\s+per\s+.+?\s+set\s+item\s+worn/i,
            extract: (match, setName, setCount) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                damageCount: DAMAGE_TYPES.length,
                multiplierType: "worn",
                multiplier: setCount,
                context: "set_per_item_each_worn"
            })
        },
        {
            name: "set_per_item_each_owned",
            // "+Y of each damage per X set item ... owned"
            regex: /\+\s*([\d,]+)\s+of\s+each\s+damage\s+per\s+.+?\s+set\s+item\s+.*?owned/i,
            extract: (match, setName, setCount) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                damageCount: DAMAGE_TYPES.length,
                multiplierType: "owned",
                multiplier: setCount,
                context: "set_per_item_each_owned"
            })
        },
        {
            name: "set_per_item_vs_raid_worn",
            // "+Y Fire damage per X set item worn vs Aquatic raids"
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+.+?\s+set\s+item\s+worn\s+vs\s+([\w\s]+?)(?:\s+raids?)?$/i,
            extract: (match, setName, setCount) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "worn",
                multiplier: setCount,
                context: "set_per_item_vs_raid_worn",
                vsType: match[3].trim()
            })
        },
        {
            name: "set_per_item_vs_raid_owned",
            // "+Y Fire damage per X set item ... owned vs Aquatic raids"
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+.+?\s+set\s+item\s+.*?owned\s+vs\s+([\w\s]+?)(?:\s+raids?)?$/i,
            extract: (match, setName, setCount) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "owned",
                multiplier: setCount,
                context: "set_per_item_vs_raid_owned",
                vsType: match[3].trim()
            })
        },
        {
            name: "distinct_owned",
            // "+Y damage per distinct Formation owned" or "+Y damage per distinct Buckler Shield owned"
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+distinct\s+(.+?)\s+owned/i,
            extract: (match, setName, setCount) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                multiplierType: "distinct",
                distinctType: match[3].trim(),  // ← Capture "Buckler Shield", "Formation", etc.
                multiplier: setCount,
                context: "distinct_owned"
            })
        },
        {
            name: "conditional_item_owned",
            // "+X damage if [Item] is owned"
            regex: /\+\s*([\d,]+)\s+(?:(fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+if\s+(.+?)\s+is\s+owned/i,
            extract: (match) => ({
                damage: parseInt(match[1].replace(/,/g, ""), 10),
                type: match[2] ? match[2].toLowerCase() : "any",
                itemName: match[3].trim(),
                multiplierType: "conditional",
                multiplier: 1,
                context: "conditional_item_owned"
            })
        }
    ];
    // ============ HELPER FUNCTIONS ============
    function formatNumber(num) {
        return num.toLocaleString();
    }
    // V4.9 FIX: Replace unsafe appendAvg/appendSetBonusAvg with safe createAvgSpan
    function createAvgSpan(avg, colorKey) {
        return `<span style="color:${userColors[colorKey]};">(${formatNumber(Math.round(avg))} Avg)</span>`;
    }
    /**
     * Try all patterns against a line and return the best match
     * @param {string} line - Text to extract from
     * @param {string} setName - Name of item set (for piece count lookup)
     * @param {boolean} isSetBonus - Whether this is a set bonus line
     * @returns {object} - { procRate, damage, totalDamage, isMatch } or null
     */
    function extractDamageData(line, setName = null, isSetBonus = false) {
        const setCount = 8;
        for (const pattern of DAMAGE_PATTERNS) {
            const match = line.match(pattern.regex);
            if (match) {
                try {
                    const data = pattern.extract(match, setName, setCount);
                    // Calculate average for proc-based effects (only if damage value exists)
                    if (data.procRate && data.damage !== undefined) {
                        data.totalDamage = data.damage * data.procRate;
                        if (data.damageCount) {
                            data.totalDamage *= data.damageCount;
                        }
                    }
                    // Calculate total for set bonuses (only if damage value exists)
                    else if (data.multiplier && data.damage !== undefined) {
                        data.totalDamage = data.damage * data.multiplier;
                        if (data.damageCount) {
                            data.totalDamage *= data.damageCount;
                        }
                    } else if (data.damage !== undefined) {
                        data.totalDamage = data.damage;
                    }
                    data.patternName = pattern.name;
                    data.isMatch = true;
                    return data;
                } catch (e) {
                    console.warn(`Pattern ${pattern.name} extraction failed:`, e);
                    continue;
                }
            }
        }
        return null;
    }
    // ============ TOOLTIP STYLING ============
    let tooltipWidth = parseInt(localStorage.getItem("tooltipWidth")) || 500;
    const tooltipWidthStyle = document.createElement("style");
    tooltipWidthStyle.id = "dotv-tooltip-width-style";
    document.head.appendChild(tooltipWidthStyle);
    function applyTooltipWidth(width) {
        const contentWidth = width;
        const outerWidth = width + 20;
        tooltipWidthStyle.textContent = `
            .item-popover-content {
                width: ${contentWidth}px !important;
            }
            .item-popover {
                width: ${outerWidth}px !important;
            }
        `;
        localStorage.setItem("tooltipWidth", width);
        // DON'T call repositionTooltip() - Vue handles its own positioning
        // Repositioning after width change causes Vue to recalculate nested popover positions
    }
    GM_addStyle(`
        .item-popover {
            max-width: 90vw !important;
            height: auto !important;
            max-height: 85vh !important;
            overflow-y: auto !important;
        }
        .item-popover-content {
            max-width: 90vw !important;
            height: auto !important;
            max-height: 85vh !important;
            overflow-y: auto !important;
        }
        .formation-swap-menu {
           width: 260px !important;
        }
        .stats-container > .dotv-select-lg > .custom-select-sub-container > .options-container {
           right: auto !important;
        }
        .item-popover-content:has(> .health-summary) {
           width: auto !important;
        }
        .item-popover:has(> .item-popover-content > .health-summary) {
           width: auto !important;
        }
        .item-popover-content:has(> .auto-fill-btn) {
           width: auto !important;
        }
        .item-popover:has(> .item-popover-content > .auto-fill-btn) {
           width: auto !important;
        }
        .army-tile-container {
          flex-wrap: nowrap !important;
        }
    `);
    applyTooltipWidth(tooltipWidth);
    // ============ MAGIC CARD FORMATTING ============
    function colorHealWords(text, healColor = '#dc143c') {
        // Color entire healing phrases in specified color (default crimson)
        const healPhrases = [
            // "+X% chance [rate and cap] to heal" pattern (with optional +)
            { phrase: /\+?\d+%\s*chance\s*\[.*?\]\s*to\s+heal/gi, replace: `<span style="color:${healColor};">$&</span>` },
            // "heal the Player X HP" pattern
            { phrase: /heal the Player \d+ HP/gi, replace: `<span style="color:${healColor};">$&</span>` },
            // "+X HP of healing" pattern (with optional +)
            { phrase: /\+?\d+ HP of healing/gi, replace: `<span style="color:${healColor};">$&</span>` },
            // "reduce incoming damage" phrase
            { phrase: /reduce incoming damage/gi, replace: `<span style="color:${healColor};">$&</span>` }
        ];
        let result = text;
        for (const { phrase, replace } of healPhrases) {
            result = result.replace(phrase, replace);
        }
        return result;
    }
    function formatMagicCardText(text) {
        // Split on semicolons OR ", plus " (using lookahead to keep "plus" in the result)
        let lines = text
            .split(/[;]|,\s*(?=plus\s)/i)
            .map(l => l.trim())
            .filter(Boolean);
        let htmlLines = [];
        let isFirstLine = true;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            // Strip any leading/trailing bullets
            line = line.replace(/^[\s•·*-]+/, '').trim();
            // For the first line, split item name from the proc description
            if (isFirstLine) {
                const colonIndex = line.indexOf(':');
                if (colonIndex !== -1) {
                    const itemName = line.substring(0, colonIndex);
                    const procDescription = line.substring(colonIndex + 1).trim();
                    // Item name with colon on its own line - completely separate
                    const styledHeader = `<div style="color:${userColors.magicProcName};text-shadow: 0 0 8px rgba(255,255,255,0.5);font-weight:bold;margin-top:0;">${itemName}:</div>`;
                    htmlLines.push(styledHeader);
                    // Proc description on the next line (not indented)
                    if (procDescription) {
                        const coloredProc = colorHealWords(procDescription, userColors.magicHealingDamage);
                        htmlLines.push(`<div style="color:${userColors.magicItemProc};font-weight:bold;margin-top:2px;">${coloredProc}</div>`);
                    }
                    isFirstLine = false;
                    continue;
                }
            }
            // Check if this is a proc line (any "% chance to" pattern)
            const isProc = /\d+%\s*chance\s+to\s+/i.test(line);
            const isBonus = line.startsWith('+') || line.toLowerCase().startsWith('plus ') || /^bonus\s+/i.test(line);
            if (isProc) {
                // Green header for proc effects
                const coloredLine = colorHealWords(line, userColors.magicHealingDamage);
                htmlLines.push(`<div style="color:${userColors.magicItemProc};font-weight:bold;margin-top:8px;">${coloredLine}</div>`);
            } else if (isBonus) {
                // Yellow indented for bonuses
                let displayLine = line;
                if (line.toLowerCase().startsWith('plus ')) {
                    displayLine = '+' + line.substring(4);
                } else if (/^bonus\s+/i.test(line)) {
                    displayLine = '+' + line.substring(5);
                }
                const coloredLine = colorHealWords(displayLine, userColors.magicHealingDamage);
                htmlLines.push(`<div style="margin-left:1.5em;margin-top:2px;color:${userColors.magicItemSubProc};">• ${coloredLine}</div>`);
            } else {
                // Green for other effects (resistances, stat changes, special abilities)
                const coloredLine = colorHealWords(line, userColors.magicHealingDamage);
                htmlLines.push(`<div style="color:${userColors.magicItemProc};font-weight:bold;margin-top:4px;">${coloredLine}</div>`);
            }
        }
        return { html: htmlLines.join('') };
    }
    function enhanceMagicCardDiv(div) {
        if (div.dataset.enhanced) return;
        let text = div.innerText.trim();
        if (!text) return;
        // Strip old averages (if any exist)
        text = text.replace(/\s*\([\d,]+\s+Avg\)/g, '');
        const { html } = formatMagicCardText(text);
        div.innerHTML = html;
        div.style.whiteSpace = 'pre-wrap';
        div.dataset.enhanced = "true";
        // Inject gear icon for color settings (once per popover)
        const itemPopover = div.closest('.item-popover');
        if (itemPopover && !itemPopover.dataset.gearInjected) {
            itemPopover.dataset.gearInjected = 'true';
            const itemHead = itemPopover.querySelector('.item-popover-head');
            if (itemHead && !itemHead.querySelector('.tooltip-gear-icon')) {
                const gearBtn = document.createElement('button');
                gearBtn.className = 'tooltip-gear-icon';
                gearBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:none;border:none;color:#a0725f;cursor:pointer;font-size:18px;padding:4px;transition:color 0.2s;z-index:100;';
                gearBtn.textContent = '⚙️';
                gearBtn.title = 'Color Settings';
                gearBtn.addEventListener('click', () => openColorSettings(itemPopover, true, div));
                gearBtn.addEventListener('mouseenter', () => gearBtn.style.color = '#FFB752');
                gearBtn.addEventListener('mouseleave', () => gearBtn.style.color = '#a0725f');
                // Add to popover container so it positions relative to the whole popover, not the head
                itemPopover.style.position = 'relative';
                itemPopover.appendChild(gearBtn);
            }
        }
        injectLocationButton(itemPopover);
    }
    function extractSetName(effectBlock) {
        // Try to find set name from text like "+260 damage per Rara Shell Collection set item worn"
        const m = effectBlock.match(/per\s+(.+?)\s+set\s+item/i);
        return m ? m[1].trim() : null;
    }
    function formatEffectText(text) {
        const [effectBlock, ...setBonusParts] = text.split(/Set Bonus/i);
        const setName = extractSetName(effectBlock);
        const setCount = 8;
        const rawLines = effectBlock
            .split(/[\r\n;]+/)
            .map(l => l.trim())
            .filter(Boolean);
        let htmlLines = [];
        let totalAvg = 0;
        let hasAnyAvg = false;
        let currentProcRate = null; // Track proc rate from the current "header" line
        let currentProcDamageCount = null; // Track damage type count for "+of each damage" sub-effects
        let isFirstEffectLine = true;
        let isFirstGreenHeader = true; // Track if this is the first green header line
        for (let i = 0; i < rawLines.length; i++) {
            let originalLine = rawLines[i];
            // Strip bullet points if present (game includes them in text, we'll add them in HTML formatting)
            let line = originalLine.replace(/^[\s•·*-]+/, '').trim();
            // Try to extract damage data
            const damageData = extractDamageData(originalLine, setName, false);
            const isArmorType = /light armor:|heavy armor:/i.test(originalLine);
            const isGreenHeader = originalLine.includes(':') || /chance to proc/i.test(originalLine);
            // Check if this line has damage and starts with + (might have bullet point before it)
            const lineWithoutBullet = originalLine.replace(/^[\s•·*-]+/, '').trim();
            const isIndentedDamage = lineWithoutBullet.startsWith('+') &&
                (/damage/i.test(originalLine) || /per/i.test(originalLine)) &&
                !/crit damage/i.test(originalLine);
            // "vs Raid" damage lines ALWAYS inherit the current proc rate - match +...damage...vs pattern
            const isVsRaidDamage = /\+.*?damage\s+.*?vs\s+/i.test(originalLine);
            // Conditional item damage lines ALWAYS inherit the current proc rate
            const isConditionalDamage = /\+\s*[\d,]+\s+.*?damage\s+if\s+.+?\s+is\s+owned/i.test(originalLine);
            // Per-unit damage lines - +X per [Unit] (owned|in Formation|and Formation owned|or...) BUT NOT "per distinct X"
            const isPerUnitDamage = /\+\s*[\d,]+\s+.*?per\s+(?!distinct).+?\s+(?:owned|in\s+the\s+(?:active\s+)?Formation|and\s+Formation\s+owned|or\s+.+?\s+in\s+the\s+(?:active\s+)?Formation)/i.test(originalLine);
            // If this is a green header (new proc effect), store its proc rate for sub-effects
            if (isGreenHeader && damageData?.procRate) {
                currentProcRate = damageData.procRate;
                // Also track the damage type count if available (for multi-damage procs)
                currentProcDamageCount = damageData.damageCount || null;
            } else if (isGreenHeader) {
                // Header with no proc rate (e.g., armor type descriptions)
                currentProcRate = null;
                currentProcDamageCount = null;
            }
            let effectiveAvg = null;
            // ---- Calculate average ----
            // IMPORTANT: Check for indented sub-effects FIRST, before using pre-calculated totalDamage
            // "vs Raid" damage, per-unit damage, and conditional damages ALWAYS inherit the current proc rate since they're part of the same proc event
            if ((isIndentedDamage || isVsRaidDamage || isConditionalDamage || isPerUnitDamage) && currentProcRate !== null) {
                // This is an indented damage line following a proc line
                // Apply the current proc rate to this sub-effect (override default calculation)
                if (damageData?.damage !== undefined) {
                    // Recalculate with inherited proc rate
                    let subAvg = damageData.damage * currentProcRate;
                    // Use user-provided amount based on multiplierType
                    if (damageData.multiplierType === "worn") {
                        subAvg *= amountWorn;
                    } else if (damageData.multiplierType === "distinct") {
                        subAvg *= getPerItemCount(damageData.distinctType);
                    } else if (damageData.multiplier) {
                        // Fallback: use baked-in multiplier (for SET patterns, etc)
                        subAvg *= damageData.multiplier;
                    }
                    // Use currentProcDamageCount if available (for "+of each damage" after multi-damage procs)
                    // Otherwise use the damageCount from the line itself
                    if (damageData.damageCount) {
                        const countToUse = currentProcDamageCount || damageData.damageCount;
                        subAvg *= countToUse;
                    }
                    // Per-unit multiplier (owned, formation, or both)
                    if (isPerUnitDamage) {
                        const unitName = extractPerUnitName(originalLine);
                        if (unitName) {
                            const unitCount = getPerUnitCount(unitName);
                            subAvg *= unitCount;
                        }
                    }
                    effectiveAvg = subAvg;
                    // For conditional items, only add to total if user owns it
                    if (damageData.context === 'conditional_item_owned') {
                        if (hasConditionalItem(damageData.itemName)) {
                            totalAvg += effectiveAvg;
                            hasAnyAvg = true;
                        }
                    } else {
                        totalAvg += effectiveAvg;
                        hasAnyAvg = true;
                    }
                }
            } else if (damageData?.totalDamage !== undefined) {
                // This line itself has damage (proc line or flat damage line, not a sub-effect)
                // Recalculate if it has a multiplier type (use user-provided values)
                if (damageData.multiplierType === "worn" || damageData.multiplierType === "distinct" || damageData.multiplier) {
                    let recalcAvg = damageData.damage;
                    if (damageData.multiplierType === "worn") {
                        recalcAvg *= amountWorn;
                    } else if (damageData.multiplierType === "distinct") {
                        recalcAvg *= getPerItemCount(damageData.distinctType);
                    } else if (damageData.multiplier) {
                        // Fallback: use baked-in multiplier (for SET patterns, etc)
                        recalcAvg *= damageData.multiplier;
                    }
                    if (damageData.damageCount) {
                        recalcAvg *= damageData.damageCount;
                    }
                    effectiveAvg = recalcAvg;
                } else {
                    effectiveAvg = damageData.totalDamage;
                }
                totalAvg += effectiveAvg;
                hasAnyAvg = true;
            }
            // ---- FORMATTING: Separate item name from description (first line only) ----
            if (isFirstEffectLine && isGreenHeader) {
                const colonIndex = line.indexOf(':');
                if (colonIndex !== -1) {
                    const itemName = line.substring(0, colonIndex);
                    const procDescription = line.substring(colonIndex + 1).trim();
                    // Item name with colon on its own line - glowing highlight header
                    const styledHeader = `<div style="color:${userColors.itemNameHighlight};text-shadow: 0 0 8px rgba(255,255,255,0.5);font-weight:bold;margin-top:0;">${itemName}:</div>`;
                    htmlLines.push(styledHeader);
                    // Proc description on the next line (green header)
                    if (procDescription) {
                        // V4.9 FIX: Append average inline during HTML generation (not during line preprocessing)
                        const avgHtml = effectiveAvg !== null ? ' ' + createAvgSpan(effectiveAvg, 'redAccent') : '';
                        htmlLines.push(`<div style="color:${userColors.greenHeader};font-weight:bold;margin-top:2px;">${procDescription}${avgHtml}</div>`);
                        isFirstGreenHeader = false;
                    }
                    isFirstEffectLine = false;
                    continue;
                }
            }
            // ---- Regular formatting for all other lines ----
            if (isArmorType) {
                htmlLines.push(`<div style="color:#4ab0f0; margin-bottom:4px;">${line}</div>`);
            } else if (isGreenHeader) {
                // First green header gets less margin (comes after title), subsequent ones get more spacing
                const marginTop = isFirstGreenHeader ? '2px' : '8px';
                // V4.9 FIX: Append average inline during HTML generation
                const avgHtml = effectiveAvg !== null ? ' ' + createAvgSpan(effectiveAvg, 'redAccent') : '';
                htmlLines.push(`<div style="color:${userColors.greenHeader};font-weight:bold;margin-top:${marginTop};">${line}${avgHtml}</div>`);
                isFirstGreenHeader = false;
            } else if (isIndentedDamage || isVsRaidDamage || isConditionalDamage || isPerUnitDamage) {
                // Sub-effects: these patterns indicate sub-effects regardless of damage extraction
                // V4.9 FIX: Append average inline during HTML generation
                const avgHtml = effectiveAvg !== null ? ' ' + createAvgSpan(effectiveAvg, 'tierMainEffect') : '';
                htmlLines.push(`<div style="margin-left:1.5em;margin-top:2px;color:${userColors.tierMainEffect};">• ${line}${avgHtml}</div>`);
            } else {
                // Regular line - includes "+X% Stat" bonuses and other non-damage bonus lines
                // V4.9 FIX: Append average inline during HTML generation
                const avgHtml = effectiveAvg !== null ? ' ' + createAvgSpan(effectiveAvg, 'redAccent') : '';
                htmlLines.push(`<div style="color:${userColors.greenHeader};font-weight:bold;">${line}${avgHtml}</div>`);
            }
            isFirstEffectLine = false;
        }
        // -------- Set Bonus --------
        let setBonusHtml = '';
        let setBonusTotal = 0;
        let hasSetBonusAvg = false;
        if (setBonusParts.length) {
            const setBonusText = setBonusParts
                .join('Set Bonus')
                .trim();
            // Use same splitting as regular procs: by newlines AND semicolons
            const setBonusRawLines = setBonusText
                .split(/[\r\n;]+/)
                .map(l => l.trim())
                .filter(Boolean);
            setBonusHtml += `<br><div style="color:${userColors.setBonusHeader};font-weight:bold;">Set Bonus</div>`;
            let currentSetBonusProcRate = null; // Track proc rate for set bonus sub-effects
            let setBonusFirstGreenHeader = true; // Track if this is the first green header in set bonus
            for (let i = 0; i < setBonusRawLines.length; i++) {
                let originalLine = setBonusRawLines[i];
                let line = originalLine.replace(/^[\s•·*-]+/, '').trim();
                const damageData = extractDamageData(line, setName, true);
                const isArmorType = /light armor:|heavy armor:/i.test(originalLine);
                const isGreenHeader = originalLine.includes(':') || /chance to proc/i.test(originalLine);
                const isTierLine = /^\d+\+?:/.test(line); // Lines like "5+:", "7+:", "8+:", "9+:"
                const lineWithoutBullet = originalLine.replace(/^[\s•·*-]+/, '').trim();
                const isIndentedDamage = lineWithoutBullet.startsWith('+') &&
                    (/damage/i.test(originalLine) || /per/i.test(originalLine)) &&
                    !/crit damage/i.test(originalLine);
                const isVsRaidDamage = /\+.*?damage\s+.*?vs\s+/i.test(originalLine);
                const isConditionalDamage = /\+\s*[\d,]+\s+.*?damage\s+if\s+.+?\s+is\s+owned/i.test(originalLine);
                const isPerUnitDamage = /\+\s*[\d,]+\s+.*?per\s+(?!distinct).+?\s+(?:owned|in\s+the\s+(?:active\s+)?Formation|and\s+Formation\s+owned|or\s+.+?\s+in\s+the\s+(?:active\s+)?Formation)/i.test(originalLine);
                // If this is a green header (new tier/proc effect), store its proc rate
                if (isGreenHeader && damageData?.procRate) {
                    currentSetBonusProcRate = damageData.procRate;
                } else if (isGreenHeader) {
                    currentSetBonusProcRate = null;
                }
                let effectiveAvg = null;
                // ---- Calculate average for set bonus ----
                // Same logic as regular procs: check for indented/vs raid/conditional damages FIRST
                if ((isIndentedDamage || isVsRaidDamage || isConditionalDamage || isPerUnitDamage) && currentSetBonusProcRate !== null) {
                    // This is a sub-effect that inherits the current proc rate
                    if (damageData?.damage !== undefined) {
                        let subAvg = damageData.damage * currentSetBonusProcRate;
                        // Use user-provided amounts if applicable
                        if (damageData.multiplierType === "worn") {
                            subAvg *= amountWorn;
                        } else if (damageData.multiplierType === "distinct") {
                            subAvg *= getPerItemCount(damageData.distinctType);
                        } else if (damageData.multiplier) {
                            // Fallback: use baked-in multiplier (for SET patterns, etc)
                            subAvg *= damageData.multiplier;
                        }
                        if (damageData.damageCount) {
                            subAvg *= damageData.damageCount;
                        }
                        // Per-unit multiplier (owned, formation, or both)
                        if (isPerUnitDamage) {
                            const unitName = extractPerUnitName(originalLine);
                            if (unitName) {
                                const unitCount = getPerUnitCount(unitName);
                                subAvg *= unitCount;
                            }
                        }
                        effectiveAvg = subAvg;
                        // For conditional items, only add to total if user owns it
                        if (damageData.context === 'conditional_item_owned') {
                            if (hasConditionalItem(damageData.itemName)) {
                                setBonusTotal += effectiveAvg;
                                hasSetBonusAvg = true;
                            }
                        } else {
                            setBonusTotal += effectiveAvg;
                            hasSetBonusAvg = true;
                        }
                    }
                } else if (damageData?.totalDamage !== undefined) {
                    // This line has damage (tier with proc rate, or flat damage)
                    effectiveAvg = damageData.totalDamage;
                    setBonusTotal += effectiveAvg;
                    hasSetBonusAvg = true;
                }
                // ---- Format HTML for display ----
                if (isArmorType) {
                    setBonusHtml += `<div style="color:#4ab0f0;">${line}</div>`;
                } else if (isTierLine) {
                    // Tier line formatting (5+:, 7+:, 8+:, 9+:) - indented with bullet
                    // V4.9 FIX: Append average inline during HTML generation
                    const avgHtml = effectiveAvg !== null ? ' ' + createAvgSpan(effectiveAvg, 'blueAccent') : '';
                    setBonusHtml += `<div style="margin-left:1.5em;margin-top:2px;color:${userColors.tierMainEffect};">• ${line}${avgHtml}</div>`;
                } else if (isGreenHeader) {
                    // Green header line (set bonus title, proc description, etc) - format like proc headers
                    // V4.9 FIX: Append average inline during HTML generation
                    const avgHtml = effectiveAvg !== null ? ' ' + createAvgSpan(effectiveAvg, 'blueAccent') : '';
                    setBonusHtml += `<div style="color:${userColors.greenHeader};font-weight:bold;margin-top:8px;">${line}${avgHtml}</div>`;
                } else if (isIndentedDamage || isVsRaidDamage || isConditionalDamage || isPerUnitDamage) {
                    // Sub-effect formatting - these patterns indicate sub-effects regardless of damage extraction
                    // V4.9 FIX: Append average inline during HTML generation
                    const avgHtml = effectiveAvg !== null ? ' ' + createAvgSpan(effectiveAvg, 'blueAccent') : '';
                    setBonusHtml += `<div style="margin-left:3em;margin-top:2px;color:${userColors.tierSubEffect};">• ${line}${avgHtml}</div>`;
                } else {
                    // Regular line
                    setBonusHtml += `<div style="color:${userColors.greenHeader};font-weight:bold;">${line}</div>`;
                }
            }
        }
        return { html: htmlLines.join('') + setBonusHtml, totalAvg, hasAnyAvg, setBonusTotal, hasSetBonusAvg };
    }
    function createWornControl() {
        // Control for global "Worn" multiplier used in "per X worn" patterns
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '6px';
        container.style.margin = '3px 0';
        container.style.fontSize = '12px';
        const label = document.createElement('span');
        label.innerText = 'Worn:';
        label.style.color = '#a0725f';
        label.style.minWidth = '45px';
        label.style.fontSize = '11px';
        const minusBtn = document.createElement('button');
        minusBtn.innerText = '−';
        minusBtn.style.width = '20px';
        minusBtn.style.height = '20px';
        minusBtn.style.background = '#3a2a1f';
        minusBtn.style.border = '1px solid #6b5344';
        minusBtn.style.color = '#a0725f';
        minusBtn.style.cursor = 'pointer';
        minusBtn.style.fontSize = '14px';
        minusBtn.style.padding = '0';
        const input = document.createElement('input');
        input.type = 'number';
        input.value = amountWorn;
        input.min = '1';
        input.max = '999';
        input.style.width = '40px';
        input.style.background = '#1a1410';
        input.style.border = '1px solid #6b5344';
        input.style.color = '#d4af37';
        input.style.padding = '2px';
        input.style.textAlign = 'center';
        input.style.fontSize = '11px';
        const plusBtn = document.createElement('button');
        plusBtn.innerText = '+';
        plusBtn.style.width = '20px';
        plusBtn.style.height = '20px';
        plusBtn.style.background = '#3a2a1f';
        plusBtn.style.border = '1px solid #6b5344';
        plusBtn.style.color = '#a0725f';
        plusBtn.style.cursor = 'pointer';
        plusBtn.style.fontSize = '14px';
        plusBtn.style.padding = '0';
        const updateValue = (newVal) => {
            const val = Math.max(1, Math.min(999, newVal));
            input.value = val;
            amountWorn = val;
            saveMultipliers();
            // Trigger recalculation on the parent popover
            const popover = input.closest('.item-popover');
            if (popover) {
                const effectsDiv = popover.querySelector('.effects');
                if (effectsDiv) {
                    effectsDiv.dataset.enhanced = '';
                    // Clear controlsInjected flag so controls are re-injected
                    popover.dataset.controlsInjected = '';
                    enhanceEffectsDiv(effectsDiv);
                }
            }
        };
        minusBtn.addEventListener('click', () => updateValue(parseInt(input.value) - 1));
        plusBtn.addEventListener('click', () => updateValue(parseInt(input.value) + 1));
        input.addEventListener('change', () => updateValue(parseInt(input.value)));
        container.appendChild(label);
        container.appendChild(minusBtn);
        container.appendChild(input);
        container.appendChild(plusBtn);
        return container;
    }
    // Legacy function name for backward compatibility
    function createMultiplierControl(type, currentValue) {
        if (type === 'worn') {
            return createWornControl();
        }
        // Owned type is no longer supported
        return null;
    }
    function extractConditionalItems(effectsText) {
        // Find all "if [Item] is owned" patterns that have "damage"
        const conditionalPattern = /\+\s*[\d,]+\s+damage\s+if\s+(.+?)\s+is\s+owned/gi;
        const items = new Set();
        let match;
        while ((match = conditionalPattern.exec(effectsText)) !== null) {
            items.add(match[1].trim());
        }
        return Array.from(items);
    }
    function extractPerItemNames(effectsText) {
        // Unified extraction for ALL "per X" patterns (except WORN - those use global multiplier only):
        // - "per distinct [X] owned"
        // - "per [X] owned"
        // - "per [X] in the active Formation"
        // - "per [X] in the Formation"
        // - "per [X] and Formation owned"
        // - "per [X] or [Y] in the Formation"
        // - "per [X], [Type] and Formation owned"
        //
        // DOES NOT include "per [X] worn" - those patterns ONLY use the global amountWorn multiplier
        const perItemSet = new Set();
        // Distinct pattern: "per distinct [X] owned"
        const distinctPattern = /\+\s*[\d,]+\s+damage\s+per\s+distinct\s+(.+?)\s+owned/gi;
        let match;
        while ((match = distinctPattern.exec(effectsText)) !== null) {
            perItemSet.add(match[1].trim());
        }
        // Per-unit OR pattern: "per X or Y in the Formation" - capture the first unit name
        const perUnitOrPattern = /\+\s*[\d,]+\s+damage\s+per\s+(.+?)\s+or\s+.+?\s+in\s+the\s+(?:active\s+)?Formation/gi;
        while ((match = perUnitOrPattern.exec(effectsText)) !== null) {
            perItemSet.add(match[1].trim());
        }
        // Per-unit pattern: "per [X] (owned|in [active] Formation|and Formation owned)"
        // Must exclude:
        // - "per distinct" using negative lookahead
        // - "per X worn" using negative lookahead (worn patterns use global amountWorn only)
        // - "per X or Y" patterns (handled above)
        const perUnitPattern = /\+\s*[\d,]+\s+damage\s+per\s+(?!distinct)(.+?)\s+(?:owned|in\s+the\s+(?:active\s+)?Formation|and\s+Formation\s+owned)/gi;
        while ((match = perUnitPattern.exec(effectsText)) !== null) {
            let itemName = match[1].trim();
            // Skip if this contains " or " - those are handled by perUnitOrPattern
            if (itemName.includes(' or ')) {
                continue;
            }
            // If multiple items comma-separated, just take the first one
            const itemList = itemName.split(',').map(i => i.trim());
            perItemSet.add(itemList[0]);
        }
        return Array.from(perItemSet);
    }
    function hasWornBonus(effectsText) {
        // Check if text contains "damage per X worn" patterns
        // Also check for "of each damage per X worn" (from multi-damage procs)
        return /\+\s*[\d,]+\s+(?:(?:fire|holy|ice|dark|lightning|poison|arcane|nature|physical|acid|psychic|magic)\s+)?damage\s+per\s+.+?\s+worn/i.test(effectsText) ||
               /of\s+each\s+damage\s+per\s+.+?\s+worn/i.test(effectsText);
    }
    function hasPerItemBonus(effectsText) {
        // Unified check for ALL "per X" patterns (distinct, per-unit owned, per-unit formation, etc)
        return extractPerItemNames(effectsText).length > 0;
    }
    function injectMultiplierControls(popover) {
        if (popover.dataset.controlsInjected) return;
        popover.dataset.controlsInjected = "true";
        const effectsDiv = popover.querySelector('.effects');
        const effectsText = effectsDiv?.innerText || '';
        // Only create controls if there are actually bonuses to control
        const hasWorn = hasWornBonus(effectsText);
        const perItems = extractPerItemNames(effectsText);  // Unified: covers distinct, per-unit, all "per X" patterns
        const conditionalItems = extractConditionalItems(effectsText);
        if (!hasWorn && perItems.length === 0 && conditionalItems.length === 0) {
            // No bonuses to control, don't inject anything
            return;
        }
        const itemContent = popover.querySelector('.item-popover-content');
        if (!itemContent) return;
        // Remove old controls if they exist (important for slider updates to display fresh values)
        const oldControls = itemContent.querySelector('.multiplier-controls');
        if (oldControls) {
            oldControls.remove();
        }
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'multiplier-controls';
        controlsContainer.style.position = 'absolute';
        controlsContainer.style.top = '8px';
        controlsContainer.style.right = '8px';
        controlsContainer.style.padding = '6px';
        controlsContainer.style.backgroundColor = 'rgba(26, 20, 16, 0.95)';
        controlsContainer.style.border = '1px solid #6b5344';
        controlsContainer.style.borderRadius = '3px';
        controlsContainer.style.minWidth = '160px';
        controlsContainer.style.maxWidth = '180px';
        controlsContainer.style.zIndex = '100';
        controlsContainer.style.fontSize = '12px';
        // Add worn control only if item has worn bonuses
        if (hasWorn) {
            controlsContainer.appendChild(createWornControl());
        }
        // Add individual checkboxes for each conditional item
        if (conditionalItems.length > 0) {
            const conditionalLabel = document.createElement('div');
            conditionalLabel.style.color = '#a0725f';
            conditionalLabel.style.fontSize = '11px';
            conditionalLabel.style.marginTop = '6px';
            conditionalLabel.style.marginBottom = '4px';
            conditionalLabel.style.borderTop = '1px solid #6b5344';
            conditionalLabel.style.paddingTop = '6px';
            conditionalLabel.innerText = 'Conditional:';
            controlsContainer.appendChild(conditionalLabel);
            for (const itemName of conditionalItems) {
                const isOwned = hasConditionalItem(itemName);
                controlsContainer.appendChild(createConditionalItemControl(itemName, isOwned));
            }
        }
        // Add sliders for all "per X" bonuses (covers distinct items, per-unit owned, per-unit formation, etc)
        if (perItems.length > 0) {
            const perItemLabel = document.createElement('div');
            perItemLabel.style.color = '#a0725f';
            perItemLabel.style.fontSize = '11px';
            perItemLabel.style.marginTop = '6px';
            perItemLabel.style.marginBottom = '4px';
            perItemLabel.style.borderTop = '1px solid #6b5344';
            perItemLabel.style.paddingTop = '6px';
            perItemLabel.innerText = 'Per Item/Unit:';
            controlsContainer.appendChild(perItemLabel);
            for (const itemName of perItems) {
                const currentCount = getPerItemCount(itemName);
                controlsContainer.appendChild(createPerItemControl(itemName, currentCount));
            }
        }
        // Make the content div relatively positioned so absolute positioning works
        itemContent.style.position = 'relative';
        // Append as first child of item-popover-content
        itemContent.insertBefore(controlsContainer, itemContent.firstChild);
    }
    function createConditionalItemControl(itemName, isOwned) {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '6px';
        container.style.margin = '3px 0';
        container.style.fontSize = '11px';
        const label = document.createElement('span');
        label.innerText = itemName.length > 18 ? itemName.substring(0, 15) + '...' : itemName;
        label.style.color = '#a0725f';
        label.style.minWidth = '85px';
        label.style.fontSize = '10px';
        label.title = itemName; // Show full name on hover
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        // Default to checked (true/owned) if not explicitly set to false in storage
        const stored = conditionalItemsStorage[itemName];
        checkbox.checked = stored !== false; // True by default
        checkbox.style.width = '14px';
        checkbox.style.height = '14px';
        checkbox.style.cursor = 'pointer';
        checkbox.addEventListener('change', () => {
            setConditionalItem(itemName, checkbox.checked);
            // Trigger recalculation on the parent popover
            const popover = checkbox.closest('.item-popover');
            if (popover) {
                const effectsDiv = popover.querySelector('.effects');
                if (effectsDiv) {
                    // Reset both enhanced and controlsInjected flags to force full recalculation
                    effectsDiv.dataset.enhanced = '';
                    popover.dataset.controlsInjected = '';
                    // Re-enhance the effects div
                    enhanceEffectsDiv(effectsDiv);
                }
            }
        });
        container.appendChild(label);
        container.appendChild(checkbox);
        return container;
    }
    function createPerItemControl(itemName, currentValue) {
        // Unified control for all "per X" patterns (distinct, per-unit, etc)
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '6px';
        container.style.margin = '3px 0';
        container.style.fontSize = '11px';
        const label = document.createElement('span');
        label.innerText = itemName.length > 18 ? itemName.substring(0, 15) + '...' : itemName;
        label.style.color = '#a0725f';
        label.style.minWidth = '85px';
        label.style.fontSize = '10px';
        label.title = itemName; // Show full name on hover
        const minusBtn = document.createElement('button');
        minusBtn.innerText = '−';
        minusBtn.style.width = '20px';
        minusBtn.style.height = '20px';
        minusBtn.style.background = '#3a2a1f';
        minusBtn.style.border = '1px solid #6b5344';
        minusBtn.style.color = '#a0725f';
        minusBtn.style.cursor = 'pointer';
        minusBtn.style.fontSize = '14px';
        minusBtn.style.padding = '0';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = '999';
        // Ensure currentValue is a valid number, default to 8
        const validValue = Math.max(1, parseInt(currentValue) || 8);
        input.value = validValue;
        input.style.width = '40px';
        input.style.background = '#1a1410';
        input.style.border = '1px solid #6b5344';
        input.style.color = '#d4af37';
        input.style.padding = '2px';
        input.style.textAlign = 'center';
        input.style.fontSize = '11px';
        const plusBtn = document.createElement('button');
        plusBtn.innerText = '+';
        plusBtn.style.width = '20px';
        plusBtn.style.height = '20px';
        plusBtn.style.background = '#3a2a1f';
        plusBtn.style.border = '1px solid #6b5344';
        plusBtn.style.color = '#a0725f';
        plusBtn.style.cursor = 'pointer';
        plusBtn.style.fontSize = '14px';
        plusBtn.style.padding = '0';
        const updateValue = (newVal) => {
            const val = Math.max(1, Math.min(999, parseInt(newVal) || 1));
            input.value = val;
            setPerItemCount(itemName, val);
            // Trigger recalculation on the parent popover
            const popover = input.closest('.item-popover');
            if (popover) {
                const effectsDiv = popover.querySelector('.effects');
                if (effectsDiv) {
                    effectsDiv.dataset.enhanced = '';
                    // Clear controlsInjected flag so controls are re-injected with fresh values
                    popover.dataset.controlsInjected = '';
                    enhanceEffectsDiv(effectsDiv);
                }
            }
        };
        minusBtn.addEventListener('click', () => {
            const currentVal = parseInt(input.value) || 1;
            updateValue(currentVal - 1);
        });
        plusBtn.addEventListener('click', () => {
            const currentVal = parseInt(input.value) || 1;
            updateValue(currentVal + 1);
        });
        input.addEventListener('change', () => {
            const currentVal = parseInt(input.value) || 1;
            updateValue(currentVal);
        });
        container.appendChild(label);
        container.appendChild(minusBtn);
        container.appendChild(input);
        container.appendChild(plusBtn);
        return container;
    }
    // Legacy functions for backward compatibility
    function createPerUnitControl(unitName, currentValue) {
        return createPerItemControl(unitName, currentValue);
    }
    function createDistinctItemControl(itemType, currentValue) {
        return createPerItemControl(itemType, currentValue);
    }
    function enhanceEffectsDiv(div) {
        if (div.dataset.enhanced) return;
        let text = div.innerText.trim();
        if (!text) return;
        // Strip old averages that might have been appended from previous calculations
        // Match patterns like "(123 Avg)" or "(1,080 Avg)" and remove them
        text = text.replace(/\s*\([\d,]+\s+Avg\)/g, '');
        const { html, totalAvg, hasAnyAvg, setBonusTotal, hasSetBonusAvg } = formatEffectText(text);
        div.innerHTML = html;
        div.style.whiteSpace = 'pre-wrap';
        div.dataset.enhanced = "true";
        // Inject gear icon for color settings (once per popover)
        const itemPopover = div.closest('.item-popover');
        if (itemPopover && !itemPopover.dataset.gearInjected) {
            itemPopover.dataset.gearInjected = 'true';
            const itemHead = itemPopover.querySelector('.item-popover-head');
            if (itemHead && !itemHead.querySelector('.tooltip-gear-icon')) {
                const gearBtn = document.createElement('button');
                gearBtn.className = 'tooltip-gear-icon';
                gearBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:none;border:none;color:#a0725f;cursor:pointer;font-size:18px;padding:4px;transition:color 0.2s;z-index:100;';
                gearBtn.textContent = '⚙️';
                gearBtn.title = 'Color Settings';
                gearBtn.addEventListener('click', () => openColorSettings(itemPopover));
                gearBtn.addEventListener('mouseenter', () => gearBtn.style.color = '#FFB752');
                gearBtn.addEventListener('mouseleave', () => gearBtn.style.color = '#a0725f');
                // Add to popover container so it positions relative to the whole popover, not the head
                itemPopover.style.position = 'relative';
                itemPopover.appendChild(gearBtn);
            }
        }
        injectLocationButton(itemPopover);
        // Inject Avg Proc and Set Bonus Total into item-popover-head
        if (hasAnyAvg || hasSetBonusAvg) {
            const itemHead = itemPopover?.querySelector('.item-popover-head');
            if (itemHead) {
                const prevTotal = itemHead.querySelector('.total-avg');
                if (prevTotal) prevTotal.remove();
                const totalDiv = document.createElement('div');
                totalDiv.className = 'total-avg';
                totalDiv.style.fontWeight = 'bold';
                totalDiv.style.marginTop = '4px';
                totalDiv.style.marginBottom = '0';
                totalDiv.style.fontSize = '14px';
                totalDiv.style.display = 'flex';
                totalDiv.style.gap = '20px';
                // Average Proc (red) - only if proc effects exist
                if (hasAnyAvg) {
                    const procDiv = document.createElement('span');
                    procDiv.style.color = userColors.redAccent;
                    procDiv.innerText = `Average Proc: ${formatNumber(Math.round(totalAvg))}`;
                    totalDiv.appendChild(procDiv);
                }
                // Set Bonus Total (blue) - only if set bonus effects exist
                if (hasSetBonusAvg) {
                    const setBonusDiv = document.createElement('span');
                    setBonusDiv.style.color = userColors.blueAccent;
                    setBonusDiv.innerText = `Set Bonus: ${formatNumber(Math.round(setBonusTotal))}`;
                    totalDiv.appendChild(setBonusDiv);
                }
                itemHead.appendChild(totalDiv);
            }
            // Inject multiplier controls only once per tooltip
            if (itemPopover && !itemPopover.dataset.controlsInjected) {
                injectMultiplierControls(itemPopover);
            }
        }
    }
    const effectsObserver = new MutationObserver(() => {
        // Format equipment effect divs
        document.querySelectorAll('.effects').forEach(enhanceEffectsDiv);
        // Format magic card text spans (in item-popover-head-details)
        document.querySelectorAll('.item-popover-head-details span').forEach(span => {
            const text = span.innerText;
            // Check if this is a magic card (has "% chance to" effects)
            if (text && /\d+%\s*chance\s+to\s+/i.test(text)) {
                enhanceMagicCardDiv(span);
            }
        });
        // Inject image zoom functionality
        injectImageZoom();
    });
    effectsObserver.observe(document.body, { childList: true, subtree: true });
})();
