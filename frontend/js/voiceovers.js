const API_BASE_URL = 'https://mhj783ssme.execute-api.us-east-1.amazonaws.com';

async function loadVoiceovers() {
  try {
    // CORRECTED: Uses the variable
    const res = await fetch(`${API_BASE_URL}/voiceovers`); 
    const voiceovers = await res.json();

    renderVoiceovers(voiceovers);
  } catch (err) {
    console.error('Error loading voiceovers:', err);
  }
}

async function searchVoiceovers(query) {
  try {
    // CORRECTED: Uses the variable
    const res = await fetch(
      `${API_BASE_URL}/voiceovers/search?q=${encodeURIComponent(query)}`
    );
    const voiceovers = await res.json();

    renderVoiceovers(voiceovers);
  } catch (err) {
    console.error('Error searching voiceovers:', err);
  }
}

function renderVoiceovers(voiceovers) {
  const container = document.getElementById('voiceover-list');
  container.innerHTML = ''; // clear any existing content

  if (voiceovers.length === 0) {
    container.innerHTML = '<p>No matching voiceovers found.</p>';
    return;
  }

  voiceovers.forEach((voice) => {
    const div = document.createElement('div');
    div.className = 'voiceover';
    div.innerHTML = `
      <p>${voice.voiceover_name} (${new Date(
      voice.project_date
    ).toLocaleDateString()})</p>
      <audio controls>
                <source src="${API_BASE_URL}/stream/${voice.file_name}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>
    `;
    container.appendChild(div);
  });
}

// Listen for input in the search bar
document.getElementById('search-bar').addEventListener('input', (e) => {
  const query = e.target.value.trim();

  // If empty, show all voiceovers again
  if (query === '') {
    loadVoiceovers();
  } else {
    searchVoiceovers(query);
  }
});

// Load voiceovers when page loads
window.addEventListener('DOMContentLoaded', loadVoiceovers);