async function loadVoiceovers() {
  try {
    const res = await fetch('/voiceovers'); // fetch all voiceovers from backend
    const voiceovers = await res.json();

    renderVoiceovers(voiceovers);
  } catch (err) {
    console.error('Error loading voiceovers:', err);
  }
}

async function searchVoiceovers(query) {
  try {
    const res = await fetch(
      `/voiceovers/search?q=${encodeURIComponent(query)}`
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
        <source src="/stream/${voice.file_name}" type="audio/mpeg">
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
