import './globals.css';

export const metadata = {
  title: 'Bolão 2026',
  description: 'Bolão da Copa do Mundo FIFA 2026',
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
