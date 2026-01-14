export default function Home() {
    return (
        <main style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: '2rem'
        }}>
            <h1 style={{ fontSize: '3rem', fontWeight: 'bold' }}>Better Zoom</h1>
            <p style={{ fontSize: '1.2rem', color: '#888' }}>Premium Video Conferencing</p>
            <button style={{
                padding: '1rem 2rem',
                fontSize: '1.2rem',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer'
            }}>
                Start Meeting
            </button>
        </main>
    );
}
