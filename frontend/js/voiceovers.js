async function loadVoiceovers() {
  try {
    const res = await fetch('/voiceovers'); // fetch all voiceovers from backend
    const voiceovers = await res.json();

    const container = document.getElementById('voiceover-list');
    container.innerHTML = ''; // clear any existing content

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
  } catch (err) {
    console.error('Error loading voiceovers:', err);
  }
}

// Load voiceovers when page loads
window.addEventListener('DOMContentLoaded', loadVoiceovers);
