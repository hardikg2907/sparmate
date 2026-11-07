// Runs before the first paint so the saved theme does not flash. Dark is the default, so only a saved
// light choice leaves the class off. It is a file, not an inline script, because the page's content security
// policy blocks inline scripts.
try {
  if (localStorage.getItem("sparmate-theme") !== "light") document.documentElement.classList.add("dark");
} catch {
  // Storage can be blocked; the new-visitor default is dark, and the app applies the saved theme once it has loaded.
  document.documentElement.classList.add("dark");
}
