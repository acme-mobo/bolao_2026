import './globals.css';
import { APP_NAME, COMPETITION_NAME } from './lib/branding.js';

export const metadata = {
  title: APP_NAME,
  description: `${APP_NAME} — ${COMPETITION_NAME}`,
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Prevent theme flash before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('theme')||'dark'}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
