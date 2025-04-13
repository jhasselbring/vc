export const DEFAULT_CRF = 24; // Default CRF if media info cannot be obtained

export function determineCrf(mediaInfo) {
    if (!mediaInfo) {
        // Keep this warning as it's useful
        // Maybe add a newline before it if other errors are common?
        console.warn(`Using default CRF ${DEFAULT_CRF} due to missing media info.`);
        return DEFAULT_CRF;
    }

    const { width, height, bitRate } = mediaInfo;
    // Handle potential NaN bitRate gracefully
    const bitRateMbps = !isNaN(bitRate) ? bitRate / 1_000_000 : 0;

    let crf;
    // Consider making this logic more configurable or adding presets
    if (bitRateMbps > 8 || height >= 1080) { // High quality source
        crf = 24; // Higher CRF for smaller size
    } else if (height >= 720) { // Medium quality source
        crf = 22;
    } else { // Lower quality source
        crf = 20; // Lower CRF to preserve more detail
    }
    // console.log(`Determined CRF: ${crf} (Resolution: ${width}x${height}, Bitrate: ${bitRateMbps > 0 ? bitRateMbps.toFixed(2) + ' Mbps' : 'N/A'})`); // Removed log
    return crf;
} 