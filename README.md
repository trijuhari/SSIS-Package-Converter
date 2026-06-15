
# SSIS Package Converter

A small utility for assisting SSIS package modernization and conversion tasks. This repository provides a lightweight frontend that parses input package definitions and generates converted output formats.

## Features
- Simple browser-based UI for converting SSIS package definitions
- Parsing module to extract package structure and metadata
- Code-generation module to emit target-format output

## Repository Contents
- `index.html` — Web UI entry point
- `app.js` — Frontend glue logic and UI handlers
- `parser.js` — Parser for input package definitions
- `codegen.js` — Generator that produces output from parsed data
- `style.css` — Basic styling for the UI

## Requirements
- A modern web browser (Chrome, Firefox, Edge)
- Optional: Node.js/npm for running a local static server or development tasks

## Quick Start
Open `index.html` in your browser for a static, no-install experience.

To serve the project locally (recommended to avoid CORS issues):

```bash
# using Python 3
python3 -m http.server 8000

# or using Node (http-server)
npx http-server -c-1

# then open http://localhost:8000
```

## Development
- Edit `parser.js` to change how input packages are parsed.
- Edit `codegen.js` to change output format or templates.
- `app.js` wires the UI controls to the parser and codegen modules.

## Project Structure

- `index.html`
- `style.css`
- `app.js`
- `parser.js`
- `codegen.js`

## Contributing
Contributions are welcome. Please fork the repository and open a pull request. For larger changes, open an issue first to discuss the design.

## License
No license specified. Add a `LICENSE` file if you want to publish this project under an open-source license.

---
_This README was updated by an assistant. Please review and customize for your project specifics._
