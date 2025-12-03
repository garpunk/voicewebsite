const API_BASE_URL = 'https://0j4mz21823.execute-api.us-east-1.amazonaws.com';
const COGNITO_CLIENT_ID = '7tvrjdqlmq5vetdobtnlpsamna';

let idToken = localStorage.getItem('id_token');

// --- AUTH FUNCTIONS ---

async function login() {
    const email = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch(`https://cognito-idp.us-east-1.amazonaws.com/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
            },
            body: JSON.stringify({
                AuthFlow: 'USER_PASSWORD_AUTH',
                ClientId: COGNITO_CLIENT_ID,
                AuthParameters: {
                    USERNAME: email,
                    PASSWORD: password
                }
            })
        });

        const data = await response.json();

        if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
            const newPassword = prompt("Please set a new permanent password:");
            if (!newPassword) return;

            const challengeResponse = await fetch(`https://cognito-idp.us-east-1.amazonaws.com/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge'
                },
                body: JSON.stringify({
                    ChallengeName: 'NEW_PASSWORD_REQUIRED',
                    ClientId: COGNITO_CLIENT_ID,
                    ChallengeResponses: {
                        USERNAME: email,
                        NEW_PASSWORD: newPassword,
                        SECRET_HASH: data.Session 
                    },
                    Session: data.Session
                })
            });
            
            const challengeData = await challengeResponse.json();
            if (challengeData.AuthenticationResult) {
                handleLoginSuccess(challengeData.AuthenticationResult.IdToken);
            } else {
                alert("Password change failed: " + (challengeData.message || "Unknown error"));
            }
        } 
        else if (data.AuthenticationResult) {
            handleLoginSuccess(data.AuthenticationResult.IdToken);
        } else {
            alert("Login failed: " + (data.message || "Check credentials"));
        }

    } catch (error) {
        console.error(error);
        alert("Login network error");
    }
}

function handleLoginSuccess(token) {
    idToken = token;
    localStorage.setItem('id_token', idToken);
    updateUIState();
    loadVoiceovers();
    alert("Logged in successfully!");
}

function logout() {
    localStorage.removeItem('id_token');
    idToken = null;
    updateUIState();
    loadVoiceovers();
}

function updateUIState() {
    const uploadContainer = document.getElementById('upload-container');
    const loginDiv = document.getElementById('login-form-div');
    const loggedInDiv = document.getElementById('logged-in-div');
    
    if (idToken) {
        if(uploadContainer) uploadContainer.classList.remove('hidden');
        if(loginDiv) loginDiv.classList.add('hidden');
        if(loggedInDiv) loggedInDiv.classList.remove('hidden');
        document.body.classList.add('is-admin');
    } else {
        if(uploadContainer) uploadContainer.classList.add('hidden');
        if(loginDiv) loginDiv.classList.remove('hidden');
        if(loggedInDiv) loggedInDiv.classList.add('hidden');
        document.body.classList.remove('is-admin');
    }
    
    // Reload list to update delete buttons visibility
    // Note: We don't call loadVoiceovers() here to avoid double-loading on init
    // Instead, we can just re-render if we have data, or fetch if empty.
    const list = document.getElementById('voiceover-list');
    if (list && list.children.length > 0) {
       // Ideally we would re-render existing data, but reloading is safer for now
       loadVoiceovers();
    }
}


// --- UPLOAD & DELETE FUNCTIONS ---

async function uploadVoiceover(event) {
    event.preventDefault();

    const form = document.getElementById('upload-form');
    const formData = new FormData(form);

    const voiceoverFile = formData.get('voiceover');
    const thumbnailFile = formData.get('thumbnail');
    const voiceoverName = formData.get('voiceover_name');
    const projectDate = formData.get('project_date');

    const mp3FileName = `${Date.now()}-${voiceoverFile.name}`;
    const thumbFileName = `${Date.now()}-thumb-${thumbnailFile.name}`;

    try {
        const reqUrlResponse = await fetch(`${API_BASE_URL}/upload-request`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': idToken 
            },
            body: JSON.stringify({ 
                mp3FileName: mp3FileName, 
                mp3ContentType: voiceoverFile.type,
                thumbFileName: thumbFileName,
                thumbContentType: thumbnailFile.type,
                voiceover_name: voiceoverName,
                project_date: projectDate 
            })
        });
        
        if (!reqUrlResponse.ok) {
             const errorResult = await reqUrlResponse.json();
             throw new Error(`Server returned error: ${errorResult.error || 'Unknown error'}`);
        }
        
        const { mp3URL, thumbURL } = await reqUrlResponse.json();
        
        await fetch(mp3URL, {
            method: 'PUT',
            headers: { 'Content-Type': voiceoverFile.type },
            body: voiceoverFile,
        });

        await fetch(thumbURL, {
            method: 'PUT',
            headers: { 'Content-Type': thumbnailFile.type },
            body: thumbnailFile,
        });
        
        alert('Upload successful! Files are now being processed by S3.');
        form.reset();
        loadVoiceovers();

    } catch (error) {
        console.error('Upload flow failed:', error);
        alert(`An unexpected error occurred during upload. ${error.message || ''}`);
    }
}

async function deleteVoiceover(id) {
  if (!confirm('Are you sure you want to delete this voiceover?')) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/voiceover/${id}`, {
      method: 'DELETE',
      headers: { 
          'Authorization': idToken 
      },
    });

    const result = await response.json();

    if (response.ok) {
      alert(result.message);
      loadVoiceovers();
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    console.error('Failed to delete voiceover:', err);
    alert('An error occurred. Check the console.');
  }
}


// --- SEARCH & DISPLAY FUNCTIONS ---

async function loadVoiceovers() {
  try {
    const res = await fetch(`${API_BASE_URL}/voiceovers`); 
    const voiceovers = await res.json();
    renderVoiceovers(voiceovers);
  } catch (err) {
    console.error('Error loading voiceovers:', err);
  }
}

// 💥 NEW: Advanced Search Logic
async function performSearch() {
  const query = document.getElementById('search-bar').value.trim();
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;

  const url = new URL(`${API_BASE_URL}/voiceovers/search`);
  if (query) url.searchParams.append('q', query);
  if (startDate) url.searchParams.append('startDate', startDate);
  if (endDate) url.searchParams.append('endDate', endDate);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Search failed');
    const voiceovers = await res.json();
    renderVoiceovers(voiceovers);
  } catch (err) {
    console.error('Error searching voiceovers:', err);
  }
}

// 💥 NEW: Clear Filters Logic
function clearFilters() {
  document.getElementById('search-bar').value = '';
  document.getElementById('start-date').value = '';
  document.getElementById('end-date').value = '';
  loadVoiceovers(); 
}

function renderVoiceovers(voiceovers) {
  const container = document.getElementById('voiceover-list');
  container.innerHTML = ''; 

  if (voiceovers.length === 0) {
    container.innerHTML = '<p class="text-center text-gray-400 col-span-3">No matching voiceovers found.</p>';
    return;
  }

  voiceovers.forEach((voice) => {
    const div = document.createElement('div');
    div.className = 'bg-dark-bg-secondary rounded-lg shadow-lg overflow-hidden w-full max-w-xs flex flex-col items-center p-4';

    const thumbnailUrl = `${API_BASE_URL}/thumbnail/${encodeURIComponent(voice.thumbnail_key)}`;
    
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
      
      <audio controls preload="none" class="w-full" src="${API_BASE_URL}/stream/${encodeURIComponent(voice.file_name)}">
        Your browser does not support the audio element.
      </audio>

     ${idToken ? `
      <button 
        class="delete-btn bg-red-600 text-white w-full py-2 px-4 rounded-lg hover:bg-red-700 transition-colors mt-4"
        data-id="${voice.id}"
      >
        Delete
      </button>
      ` : ''}
    `;
    container.appendChild(div);
  });
}


// --- INITIALIZATION & EVENT LISTENERS ---

window.addEventListener('DOMContentLoaded', () => {
  // 1. Initial Load
  loadVoiceovers(); 
  // 2. Check Auth State
  updateUIState();
  
  // 3. Global Click Listener for Delete Buttons
  const listContainer = document.getElementById('voiceover-list');
  listContainer.addEventListener('click', (event) => {
    if (event.target.classList.contains('delete-btn')) {
      const voiceoverId = event.target.dataset.id;
      deleteVoiceover(voiceoverId);
    }
  });
});

// Search Bar Input Listener
document.getElementById('search-bar').addEventListener('input', (e) => {
  // Optional: Add debounce here if needed
  performSearch();
});

// Upload Form Listener
document.getElementById('upload-form').addEventListener('submit', uploadVoiceover);

// Play One Audio at a Time
document.addEventListener('play', function(e){
    var audios = document.getElementsByTagName('audio');
    for(var i = 0, len = audios.length; i < len;i++){
        if(audios[i] != e.target){
            audios[i].pause();
        }
    }
}, true);

// Attach global functions for HTML onclick attributes
window.login = login;
window.logout = logout;
window.performSearch = performSearch;
window.clearFilters = clearFilters;