// Reads a hook's stdin JSON and prints the file path the tool touched.
// Exists because `jq` is not installed on this machine, but node always is
// (the frontend needs it), so every hook can rely on it.
let s = ''
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  try {
    const j = JSON.parse(s)
    const p =
      (j.tool_response && j.tool_response.filePath) ||
      (j.tool_input && j.tool_input.file_path) ||
      ''
    process.stdout.write(String(p))
  } catch {
    /* malformed payload -> print nothing, caller exits 0 */
  }
})
