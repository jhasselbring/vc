import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';

// Helper to run a command asynchronously and capture output/errors
function runCommandAsync(command, args, filePath, ignoreStdErr = false) {
    return new Promise((resolve, reject) => {
        const process = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }); // stdin, stdout, stderr
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('error', (error) => {
            // Errors when spawning the process itself
            reject({ type: 'spawn_error', message: error.message, filePath });
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                // Command executed but returned an error code
                reject({ type: 'command_error', code, stderr: ignoreStdErr ? "<stderr ignored>" : stderr, filePath });
            }
        });
    });
}

export async function getMediaInfo(filePath) {
  // console.log(`Probing: ${filePath}`);
  const ffprobeArgs = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'v:0',
    filePath,
  ];

  try {
    const stdout = await runCommandAsync('ffprobe', ffprobeArgs, filePath, true); // Ignore stderr for ffprobe unless error code
    const output = JSON.parse(stdout); // Potential JSON parse error
    const stream = output.streams && output.streams[0];

    if (!stream) {
      process.stdout.write('\n'); // Newline before warning
      console.warn(chalk.yellow(`No video stream found in ${path.basename(filePath)}`));
      return null; // Not an error, just no stream
    }

    const width = parseInt(stream.width, 10);
    const height = parseInt(stream.height, 10);
    const bitRate = stream.bit_rate ? parseInt(stream.bit_rate, 10) : NaN;

    if (isNaN(width) || isNaN(height)) {
      process.stdout.write('\n');
      console.warn(chalk.yellow(`Could not parse width/height for ${path.basename(filePath)}`));
      return null; // Info missing
    }

    return { width, height, bitRate };

  } catch (error) {
    process.stdout.write('\n'); // Ensure errors/warnings are on new lines
    if (error.type === 'spawn_error') {
        console.error(chalk.red(`ffprobe spawn error for ${path.basename(filePath)}:`), error.message);
    } else if (error.type === 'command_error') {
        console.error(chalk.red(`ffprobe failed for ${path.basename(filePath)}: Status ${error.code}`));
        // stderr might be useful here even if ignored on success
        // console.error('ffprobe stderr:', error.stderr);
    } else { // Likely JSON parse error or other code error
        console.error(chalk.red(`Error parsing ffprobe output for ${path.basename(filePath)}:`), error.message);
    }
    return null; // Indicate failure to get info
  }
}

function moveFailedFile(filePath, rootDir) {
    try {
        const parentDir = path.dirname(rootDir);
        const targetDirName = path.basename(rootDir);
        const relativeFilePath = path.relative(rootDir, filePath);
        // Ensure relative path doesn't start with '..' if file is already outside rootDir somehow
        const safeRelativePath = relativeFilePath.startsWith('..') ? path.basename(filePath) : relativeFilePath;
        const failedDirPath = path.join(parentDir, `@failed_vc_${targetDirName}`, path.dirname(safeRelativePath));
        const failedFilePath = path.join(failedDirPath, path.basename(safeRelativePath));

        fs.mkdirSync(failedDirPath, { recursive: true });
        // Check if file still exists before moving (it might have been deleted successfully before a later step failed)
        if (fs.existsSync(filePath)) {
            fs.renameSync(filePath, failedFilePath);
            process.stdout.write('\n');
            console.log(chalk.yellow(`Moved failed file to: ${failedFilePath}`));
        } else {
             process.stdout.write('\n');
             console.log(chalk.yellow(`Original file ${path.basename(filePath)} was already removed or moved.`));
        }
    } catch (moveError) {
        process.stdout.write('\n');
        console.error(chalk.red(`Failed to move file ${filePath} after conversion error:`), moveError.message);
    }
}

// Updated to use async spawn
export async function convertToWebm(filePath, dryRun, crf, rootDir) {
  const parsedPath = path.parse(filePath);
  const outputFilePath = path.join(parsedPath.dir, `${parsedPath.name}.webm`);

  if (dryRun) {
    return 'skipped_dry_run';
  }

  // Check for existing output *before* running ffmpeg
  if (fs.existsSync(outputFilePath)) {
      return 'skipped_exists';
  }

  const ffmpegArgs = [
    '-i', filePath,
    '-c:v', 'libvpx-vp9',
    '-crf', crf.toString(),
    '-b:v', '0',
    '-c:a', 'libopus',
    '-cpu-used', '0',
    '-y', // Overwrite temp/incomplete files without asking
    outputFilePath,
  ];


  try {
      // Run ffmpeg asynchronously
      await runCommandAsync('ffmpeg', ffmpegArgs, filePath);

      // If runCommandAsync resolves, ffmpeg succeeded (exit code 0)
      try {
          fs.unlinkSync(filePath); // Delete original file
          return 'converted';
      } catch (deleteError) {
          process.stdout.write('\n');
          console.error(chalk.red(`Converted successfully, but failed to delete original ${path.basename(filePath)}:`), deleteError.message);
          return 'error_deleting'; // Indicate partial failure
      }

  } catch (error) {
      process.stdout.write('\n'); // Newline before error messages
      if (error.type === 'spawn_error') {
          console.error(chalk.red(`FFmpeg spawn error for ${path.basename(filePath)}:`), error.message);
      } else if (error.type === 'command_error') {
          console.error(chalk.red(`FFmpeg conversion failed for ${path.basename(filePath)} (code: ${error.code}):`));
          console.error(chalk.gray(error.stderr || 'No stderr captured.')); // Show ffmpeg output on error
      } else {
          console.error(chalk.red(`Unexpected error during FFmpeg processing for ${path.basename(filePath)}:`), error);
      }

      // Clean up potentially incomplete output file on failure
      if (fs.existsSync(outputFilePath)) {
          try {
              fs.unlinkSync(outputFilePath);
          } catch (cleanupError) {
              console.error(chalk.yellow(`Failed to delete incomplete output ${path.basename(outputFilePath)}:`), cleanupError.message);
          }
      }

      // Move the original failed source file
      moveFailedFile(filePath, rootDir);
      return 'error_converting'; // Indicate failure
  }
} 