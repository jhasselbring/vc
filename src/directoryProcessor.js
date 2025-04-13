import fs from 'node:fs';
import path from 'node:path';
import { getMediaInfo, convertToWebm } from './ffmpegUtils.js';
import { determineCrf } from './crfUtils.js';

// Consider adding error handling for file system operations
export async function processDirectory(dirPath, dryRun) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await processDirectory(fullPath, dryRun); // Recurse and wait
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Maybe add more sophisticated file type checking (e.g., mime types)
        if (ext !== '.webm') {
          // Await media info before proceeding
          const mediaInfo = await getMediaInfo(fullPath);
          const crf = determineCrf(mediaInfo);
          // No need to await conversion unless running jobs in parallel
          convertToWebm(fullPath, dryRun, crf);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err.message);
    // Decide if the error is critical and should stop the process
  }
} 