const API_BASE_URL = 'https://0j4mz21823.execute-api.us-east-1.amazonaws.com';

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

async function deleteVoiceover(id) {
  // 1. Confirm with the user
  if (!confirm('Are you sure you want to delete this voiceover?')) {
    return;
  }

  try {
    // 2. Send the DELETE request to the backend
    const response = await fetch(`${API_BASE_URL}/voiceover/${id}`, {
      method: 'DELETE',
    });

    const result = await response.json();

    if (response.ok) {
      alert(result.message);
      loadVoiceovers(); // 3. Refresh the list
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    console.error('Failed to delete voiceover:', err);
    alert('An error occurred. Check the console.');
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
    // 1. Create the main div
    const div = document.createElement('div');
    // 2. Apply Tailwind classes for styling and centering
    div.className = 'bg-dark-bg-secondary rounded-lg shadow-lg overflow-hidden w-full max-w-xs flex flex-col items-center p-4';

    // 3. Construct the thumbnail URL
    const thumbnailUrl = `${API_BASE_URL}/thumbnail/${encodeURIComponent(voice.thumbnail_key)}`;
    
    // 4. Set the inner HTML with Tailwind classes
    div.innerHTML = `
      <img src="${thumbnailUrl}" alt="${voice.voiceover_name} thumbnail" 
           class="w-48 h-48 object-cover rounded-md mb-4 shadow-md">
      
      <div class="text-center">
        <p class="text-lg font-semibold text-dark-text truncate w-60" title="${voice.voiceover_name}">
          ${voice.voiceover_name}
        </p>
        <p class="text-sm text-dark-text-secondary mb-3">
          ${new Date(voice.project_date).toLocaleDateString()}
        </p>
      </div>
      
      <audio controls preload="none" class="w-full">
        <source src="${API_BASE_URL}/stream/${encodeURIComponent(voice.file_name)}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>

      <button 
        class="delete-btn bg-red-600 text-white w-full py-2 px-4 rounded-lg hover:bg-red-700 transition-colors mt-4"
        data-id="${voice.id}"
      >
        Delete
      </button>
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
window.addEventListener('DOMContentLoaded', () => {
  loadVoiceovers(); // This line is already here

  
  const listContainer = document.getElementById('voiceover-list');
  listContainer.addEventListener('click', (event) => {
    // Check if the clicked element is a delete button
    if (event.target.classList.contains('delete-btn')) {
      const voiceoverId = event.target.dataset.id;
      deleteVoiceover(voiceoverId);
    }
  });
});

document.addEventListener('play', function(e){
    var audios = document.getElementsByTagName('audio');
    for(var i = 0, len = audios.length; i < len;i++){
        if(audios[i] != e.target){
            audios[i].pause();
        }
    }
}, true);