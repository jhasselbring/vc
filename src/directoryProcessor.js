import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { getMediaInfo, convertToWebm } from './ffmpegUtils.js';
import { determineCrf } from './crfUtils.js';

// Helper function to count processable files
export function countFiles(dirPath) {
    let count = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                count += countFiles(fullPath); // Recurse
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (ext !== '.webm') {
                    count++;
                }
            }
        }
    } catch (err) {
        // Log error but continue counting other directories if possible
        console.error(`Error counting files in ${dirPath}:`, err.message);
    }
    return count;
}

// Updated function to accept progress state and total count
export async function processDirectory(dirPath, dryRun, progress, totalFiles, rootDir) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await processDirectory(fullPath, dryRun, progress, totalFiles, rootDir); // Pass state down
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.webm') {
          // Increment count *before* processing attempts
          progress.count++;
          const percentage = totalFiles > 0 ? Math.round((progress.count / totalFiles) * 100) : 0;
          const relativePath = path.relative(rootDir, fullPath);

          // Update progress line
          process.stdout.write(
            `\r${chalk.blue(path.basename(rootDir))}: [${chalk.cyan(progress.count)}/${chalk.cyan(totalFiles)}] ${chalk.yellow(percentage + '%')} - Processing ${chalk.gray(relativePath)}...`
          );

          const mediaInfo = await getMediaInfo(fullPath); // Might log errors
          const crf = determineCrf(mediaInfo);          // Might log warnings
          const result = convertToWebm(fullPath, dryRun, crf, rootDir); // Might log errors

          const finalPercentage = totalFiles > 0 ? Math.round((progress.count / totalFiles) * 100) : 0;
          const statusIndicator = result === 'converted' ? chalk.green('✓') :
                                  result === 'skipped_exists' ? chalk.blue('-') :
                                  result === 'skipped_dry_run' ? chalk.gray('DRY') :
                                  chalk.red('✗'); // Failed

          // Update progress line, overwriting "Processing..."
          process.stdout.write(
            `\r${chalk.blue(path.basename(rootDir))}: [${chalk.cyan(progress.count)}/${chalk.cyan(totalFiles)}] ${chalk.yellow(finalPercentage + '%')} ${statusIndicator} ${chalk.gray(relativePath)}                           ` // Pad with spaces
          );

          // If it wasn't a conversion or skip, print a newline so the next line doesn't overwrite it.
          // Errors/warnings within the functions should already print newlines.
          if (result !== 'converted' && result !== 'skipped_exists' && result !== 'skipped_dry_run') {
             process.stdout.write('\n');
             // Re-print the progress line without the 'Processing...' part, so it stays visible above errors
             process.stdout.write(
               `\r${chalk.blue(path.basename(rootDir))}: [${chalk.cyan(progress.count)}/${chalk.cyan(totalFiles)}] ${chalk.yellow(finalPercentage + '%')} ${statusIndicator} ${chalk.gray(relativePath)}                           `
             );
          }
        }
      }
    }
  } catch (err) {
      process.stdout.write('\n'); // Ensure errors start on a new line
      console.error(chalk.red(`Error reading directory ${dirPath}:`), err.message);
  }
} 