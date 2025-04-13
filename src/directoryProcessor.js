import fs from 'node:fs';
import path from 'node:path';

// Recursively finds all files not ending in .webm
export function findFilesToProcess(dirPath) {
    let files = [];
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                files = files.concat(findFilesToProcess(fullPath)); // Recurse and combine
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (ext !== '.webm') {
                    files.push(fullPath);
                }
            }
        }
    } catch (err) {
        // Log error but try to continue finding files in other directories
        // This error should ideally be reported more prominently
        console.error(`\nError scanning directory ${dirPath}: ${err.message}`);
    }
    return files;
} 