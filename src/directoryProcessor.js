import fs from 'node:fs/promises';
import path from 'node:path';

// Recursively finds all files not ending in .webm asynchronously
export async function findFilesToProcess(dirPath) {
    let files = [];
    try {
        // Use asynchronous readdir
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const promises = entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name);
            try {
                if (entry.isDirectory()) {
                    // Recurse asynchronously and add results
                    const subFiles = await findFilesToProcess(fullPath);
                    files.push(...subFiles);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (ext !== '.webm') {
                        files.push(fullPath);
                    }
                }
                // Ignore other entry types (symlinks, etc.) for now
            } catch (entryError) {
                // Log error processing a specific entry but continue with others
                console.error(`\nError processing entry ${fullPath}: ${entryError.message}`);
            }
        });
        // Wait for all operations within this directory to complete
        await Promise.all(promises);
    } catch (err) {
        // Log error reading the directory itself
        console.error(`\nError scanning directory ${dirPath}: ${err.message}`);
        // Depending on the error, you might want to re-throw or handle differently
    }
    return files;
} 