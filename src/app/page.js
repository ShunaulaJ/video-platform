import Room from '../components/Room';

export default function Home() {
    return (
        <main style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            gap: '2rem',
            padding: '2rem'
        }}>
            <h1 style={{ fontSize: '3rem', fontWeight: 'bold', margin: 0 }}>Better Zoom</h1>
            <p style={{ fontSize: '1.2rem', color: '#888', margin: 0 }}>Premium Video Conferencing</p>

            <Room />
        </main>
    );
}
