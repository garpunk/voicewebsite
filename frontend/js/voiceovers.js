const API_BASE_URL = 'https://7r1zcfg22i.execute-api.us-east-1.amazonaws.com';

// --- FUNCTION DEFINITIONS ---

/**
 * Handles the multi-step file upload process.
 */
async function uploadVoiceover(event) {
    event.preventDefault(); // Stop the default form submission (page reload)

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
                mp3ContentType: voiceoverFile.type,
                thumbFileName: thumbFileName,
                thumbContentType: thumbnailFile.type,
                voiceover_name: voiceoverName,
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
        loadVoiceovers(); // This call is OK because the function is defined below

    } catch (error) {
        console.error('Upload flow failed:', error);
        alert(`An unexpected error occurred during upload. ${error.message || ''}`);
    }
}

/**
 * Fetches the list of all voiceovers from the backend.
 */
async function loadVoiceovers() {
  try {
    const res = await fetch(`${API_BASE_URL}/voiceovers`); 
    const voiceovers = await res.json();
    renderVoiceovers(voiceovers);
  } catch (err) {
    console.error('Error loading voiceovers:', err);
  }
}

/**
 * Fetches a filtered list based on a search query.
 */
async function searchVoiceovers(query) {
  try {
    const res = await fetch(
      `${API_BASE_URL}/voiceovers/search?q=${encodeURIComponent(query)}`
    );
    const voiceovers = await res.json();
    renderVoiceovers(voiceovers);
  } catch (err) {
    console.error('Error searching voiceovers:', err);
  }
}

/**
 * Renders the list of voiceovers (with thumbnails) to the DOM.
 */
function renderVoiceovers(voiceovers) {
  const container = document.getElementById('voiceover-list');
  container.innerHTML = ''; 

  if (voiceovers.length === 0) {
    container.innerHTML = '<p>No matching voiceovers found.</p>';
    return;
  }

  voiceovers.forEach((voice) => {
    // 💥 This is where the 'div' variable must be defined
    const div = document.createElement('div');
    div.className = 'voiceover';

    const thumbnailUrl = `${API_BASE_URL}/thumbnail/${encodeURIComponent(voice.thumbnail_key)}`;
    
    div.innerHTML = `
      <div class="voiceover-content">
        <img src="${thumbnailUrl}" alt="${voice.voiceover_name} thumbnail" style="width: 100px; height: 100px; object-fit: cover;">
        <div class="voiceover-details">
          <p>${voice.voiceover_name} (${new Date(
            voice.project_date
          ).toLocaleDateString()})</p>
          <audio controls>
            <source src="${API_BASE_URL}/stream/${encodeURIComponent(voice.file_name)}" type="audio/mpeg">
            Your browser does not support the audio element.
          </audio>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}


// --- EVENT LISTENERS (Must be at the bottom) ---

// Listen for input in the search bar
document.getElementById('search-bar').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  if (query === '') {
    loadVoiceovers();
  } else {
    searchVoiceovers(query);
  }
});

// Add event listener for your upload form
document.getElementById('upload-form').addEventListener('submit', uploadVoiceover);

// Load voiceovers when page loads
window.addEventListener('DOMContentLoaded', loadVoiceovers);