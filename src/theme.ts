const STORAGE_KEY = 'scrub-theme';
const toggleBtn = document.getElementById('themeToggle') as HTMLButtonElement;

function applyTheme(dark: boolean) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  toggleBtn.textContent = dark ? '☀️' : '🌙';
  toggleBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

export function initTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = stored ? stored === 'dark' : prefersDark;
  applyTheme(dark);

  toggleBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyTheme(!isDark);
    localStorage.setItem(STORAGE_KEY, !isDark ? 'dark' : 'light');
  });
}
