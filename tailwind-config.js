tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            colors: {
                zinc: {
                    750: '#27272a',
                    850: '#1f1f23',
                    900: '#18181b', // Default zinc-900 (Header)
                    950: '#09090b', // App BG
                }
            }
        }
    }
}
