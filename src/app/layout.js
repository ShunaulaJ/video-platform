import './globals.css';

export const metadata = {
    title: 'Better Zoom',
    description: 'High-quality video conferencing platform',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
