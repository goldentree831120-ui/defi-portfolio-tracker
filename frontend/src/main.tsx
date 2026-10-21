import '@fontsource-variable/manrope'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { configResult } from './lib/config'

const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    {configResult.ok ? (
      <App config={configResult.config} />
    ) : (
      <main className="app">
        <section className="gate">
          <h1>The app is misconfigured</h1>
          <p>Fix these in frontend/.env and restart the dev server:</p>
          <ul>
            {configResult.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
      </main>
    )}
  </StrictMode>,
)
