const API_BASE_URL = 'https://mhj783ssme.execute-api.us-east-1.amazonaws.com';

// ------------------------------------------------------------------
// 💥 NEW UPLOAD LOGIC: Uses Presigned URLs for direct S3 upload
// ------------------------------------------------------------------
async function uploadVoiceover(event) {
    event.preventDefault();

    const form = document.getElementById('upload-form');
    const formData = new FormData(form);

    const voiceoverFile = formData.get('voiceover');
    const thumbnailFile = formData.get('thumbnail');
    const voiceoverName = formData.get('voiceover_name');
    const projectDate = formData.get('project_date');

    // 1. Prepare unique file names for S3
    const mp3FileName = `${Date.now()}-${voiceoverFile.name}`;
    const thumbFileName = `${Date.now()}-thumb-${thumbnailFile.name}`;

    try {
        // --- STEP 1: Request Presigned URLs (Small API call) ---
        const reqUrlResponse = await fetch(`${API_BASE_URL}/upload-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mp3FileName: mp3FileName, 
                thumbFileName: thumbFileName,
                voiceover_name: voiceoverName, // Ensure keys match backend expectations
                project_date: projectDate 
            })
        });
        
        // Check for server error before parsing JSON
        if (!reqUrlResponse.ok) {
             const errorResult = await reqUrlResponse.json();
             throw new Error(`Server returned error: ${errorResult.error || 'Unknown error'}`);
        }
        
        const { mp3URL, thumbURL } = await reqUrlResponse.json();
        
        // --- STEP 2: Upload MP3 Directly to S3 (Large file transfer via HTTP PUT) ---
        await fetch(mp3URL, {
            method: 'PUT',
            headers: { 'Content-Type': voiceoverFile.type },
            body: voiceoverFile, // Send raw file data
        });

        // --- STEP 3: Upload Thumbnail Directly to S3 (File transfer via HTTP PUT) ---
        await fetch(thumbURL, {
            method: 'PUT',
            headers: { 'Content-Type': thumbnailFile.type },
            body: thumbnailFile, // Send raw file data
        });
        
        // Success handling
        alert('Upload successful! Files are now being processed by S3.');
        form.reset();
        loadVoiceovers();

    } catch (error) {
        console.error('Upload flow failed:', error);
        alert(`An unexpected error occurred during upload. ${error.message || ''}`);
    }
}

// ------------------------------------------------------------------
// Existing Code (Load, Search, Render)
// ------------------------------------------------------------------

// Add event listener for your upload form (assuming its ID is 'upload-form')
document.getElementById('upload-form').addEventListener('submit', uploadVoiceover);

// ... (loadVoiceovers, searchVoiceovers, renderVoiceovers functions remain the same) ...

// Load voiceovers when page loads
window.addEventListener('DOMContentLoaded', loadVoiceovers);