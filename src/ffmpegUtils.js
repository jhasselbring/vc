import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';

export async function getMediaInfo(filePath) {
  const ffprobeArgs = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'v:0',
    filePath,
  ];

  try {
    const result = spawnSync('ffprobe', ffprobeArgs, { encoding: 'utf8' });

    if (result.status !== 0 || result.error) {
      process.stdout.write('\n');
      console.error(chalk.red(`ffprobe failed for ${path.basename(filePath)}: Status ${result.status}`));
      if (result.stderr) console.error('ffprobe stderr:', result.stderr);
      if (result.error) console.error('ffprobe spawn error:', result.error);
      return null;
    }

    const output = JSON.parse(result.stdout);
    const stream = output.streams && output.streams[0];

    if (!stream) {
      process.stdout.write('\n');
      console.warn(chalk.yellow(`No video stream found in ${path.basename(filePath)}`));
      return null;
    }

    const width = parseInt(stream.width, 10);
    const height = parseInt(stream.height, 10);
    const bitRate = stream.bit_rate ? parseInt(stream.bit_rate, 10) : NaN;

    if (isNaN(width) || isNaN(height)) {
      process.stdout.write('\n');
      console.warn(chalk.yellow(`Could not parse width/height for ${path.basename(filePath)}`));
      return null;
    }

    return { width, height, bitRate };

  } catch (error) {
    process.stdout.write('\n');
    console.error(chalk.red(`Error running ffprobe for ${path.basename(filePath)}:`), error.message);
    if (error.stderr) {
        console.error('ffprobe stderr:', error.stderr.toString());
    }
    return null;
  }
}

function moveFailedFile(filePath, rootDir) {
    try {
        const parentDir = path.dirname(rootDir);
        const targetDirName = path.basename(rootDir);
        const relativeFilePath = path.relative(rootDir, filePath);
        const failedDirPath = path.join(parentDir, `@failed_vc_${targetDirName}`, path.dirname(relativeFilePath));
        const failedFilePath = path.join(failedDirPath, path.basename(relativeFilePath));

        fs.mkdirSync(failedDirPath, { recursive: true });
        fs.renameSync(filePath, failedFilePath);
        process.stdout.write('\n');
        console.log(chalk.yellow(`Moved failed file to: ${failedFilePath}`));
    } catch (moveError) {
        process.stdout.write('\n');
        console.error(chalk.red(`Failed to move file ${filePath} after conversion error:`), moveError.message);
    }
}

export function convertToWebm(filePath, dryRun, crf, rootDir) {
  const parsedPath = path.parse(filePath);
  const outputFilePath = path.join(parsedPath.dir, `${parsedPath.name}.webm`);

  if (dryRun) {
    return 'skipped_dry_run';
  }

  const ffmpegArgs = [
    '-i', filePath,
    '-c:v', 'libvpx-vp9',
    '-crf', crf.toString(),
    '-b:v', '0',
    '-c:a', 'libopus',
    '-cpu-used', '0',
    '-y',
    outputFilePath,
  ];

  try {
    if (fs.existsSync(outputFilePath)) {
        return 'skipped_exists';
    }

    const result = spawnSync('ffmpeg', ffmpegArgs, { stdio: 'pipe' });

    if (result.status === 0) {
      try {
        fs.unlinkSync(filePath);
        return 'converted';
      } catch (deleteError) {
        process.stdout.write('\n');
        console.error(chalk.red(`Successfully converted, but failed to delete original file ${path.basename(filePath)}:`), deleteError.message);
        return 'error_deleting';
      }
    } else {
      process.stdout.write('\n');
      console.error(chalk.red(`FFmpeg conversion failed for ${path.basename(filePath)}:`));
      console.error(`Status: ${result.status}`);
      if (result.stderr) {
        console.error('FFmpeg stderr:', result.stderr.toString());
      }
       if (result.error) {
           console.error('Spawn error:', result.error);
       }
      if (fs.existsSync(outputFilePath)) {
          try {
              fs.unlinkSync(outputFilePath);
          } catch (cleanupError) {
              console.error(chalk.yellow(`Error deleting incomplete output file ${path.basename(outputFilePath)}:`), cleanupError.message);
          }
      }
      moveFailedFile(filePath, rootDir);
      return 'error_converting';
    }
  } catch (spawnError) {
    process.stdout.write('\n');
    console.error(chalk.red(`Error spawning FFmpeg for ${path.basename(filePath)}:`), spawnError.message);
    moveFailedFile(filePath, rootDir);
    return 'error_spawning';
  }
} 