import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- Configuration ---
//  const API_BASE_URL = "http://127.0.0.1:8000";
const API_BASE_URL = "https://v-compassapi.onrender.com";
const NOTIFICATION_RADIUS_KM = 30;
const MINIMUM_ALTITUDE_FT = 10000;
const TRACKING_INTERVAL_MS = 15000;
const MOCK_TRACKING_INTERVAL_MS = 25000;

// --- Helper Functions and Components ---
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);  
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const calculateBearing = (lat1, lon1, lat2, lon2) => {
    const toRad = (deg) => deg * Math.PI / 180;
    const toDeg = (rad) => rad * 180 / Math.PI;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

const getDirectionPhrase = (bearing) => {
    if (bearing > 337.5 || bearing <= 22.5) return ["North"];
    if (bearing > 22.5 && bearing <= 67.5) return ["NorthEast"];
    if (bearing > 67.5 && bearing <= 112.5) return ["East"];
    if (bearing > 112.5 && bearing <= 157.5) return ["EastSouth"];
    if (bearing > 157.5 && bearing <= 202.5) return ["South"];
    if (bearing > 202.5 && bearing <= 247.5) return ["SouthWest"];
    if (bearing > 247.5 && bearing <= 292.5) return ["West"];
    if (bearing > 292.5 && bearing <= 337.5) return ["NorthWest"];
    return [];
};

const Compass = ({ bearing }) => {
    return (
        <div className="relative w-64 h-64 sm:w-80 sm:h-80 rounded-full bg-gray-200 border-8 border-gray-300 shadow-lg flex items-center justify-center">
            <span className="absolute top-2 text-xl font-bold text-gray-600">N</span>
            <span className="absolute bottom-2 text-xl font-bold text-gray-600">S</span>
            <span className="absolute left-5 text-xl font-bold text-gray-600">W</span>
            <span className="absolute right-5 text-xl font-bold text-gray-600">E</span>
            <div 
                className="absolute w-0 h-0"
                style={{
                    borderLeft: '1rem solid transparent',
                    borderRight: '1rem solid transparent',
                    borderBottom: '8rem solid #ef4444',
                    top: '1rem',
                    transformOrigin: 'bottom center',
                    transform: `rotate(${bearing}deg)`,
                }}
            />
            <div className="w-4 h-4 bg-gray-800 rounded-full z-10"></div>
        </div>
    );
};

const PlaneNotification = ({ plane, onSpeakDirection }) => {
    if (!plane) return null;

    return (
        <div className="w-full max-w-md p-4 mt-8 bg-white rounded-xl shadow-2xl animate-fade-in-up border border-blue-200">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-800">✈️ Plane Detected Overhead!</h3>
                <span className={`px-2 py-1 text-xs font-semibold text-white rounded-full ${plane.isMock ? 'bg-purple-500' : 'bg-green-500'}`}>
                    {plane.isMock ? 'MOCK' : 'LIVE'}
                </span>
            </div>
            <p className="mt-2 text-gray-600">
                Look up! Flight <span className="font-bold">{plane.callsign || 'N/A'}</span> is passing by.
            </p>
            <ul className="mt-3 text-sm text-gray-500">
                <li><strong>Altitude:</strong> {Math.round(plane.altitude_ft)} ft</li>
                <li><strong>Speed:</strong> {Math.round(plane.velocity_ms * 1.944)} knots</li>
            </ul>
            <button 
                onClick={onSpeakDirection}
                className="w-full mt-4 px-4 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-transform transform hover:scale-105"
            >
                Tell Me Where to Look
            </button>
        </div>
    );
};

export default function App() {
    // --- State and Refs ---
    const [isTracking, setIsTracking] = useState(false);
    const [isMockMode, setIsMockMode] = useState(false);
    const [userLocation, setUserLocation] = useState(null);
    const [detectedPlane, setDetectedPlane] = useState(null);
    const [bearing, setBearing] = useState(0);
    const [statusMessage, setStatusMessage] = useState("Vimaanam Compass your compass to happiness.");
    
    const soundFiles = {
        notification: "/arfan-odraa.mp3",
        North: "/aruna-vadak.mp3",
        South: "/aruna-thekk.mp3",
        East: "/aruna-kizhakk.mp3",
        West: "/aruna-padinjaru.mp3",
        NorthWest: "/fadil-north-west.mp3",
        NorthEast: "/fadil-north-east.mp3",
        SouthWest: "/fadil-south-west.mp3",
        EastSouth: "/fadil-east-south.mp3",
    };

    const audioPlayerRef = useRef(null);
    const notificationPlayerRef = useRef(null); // Ref for the dedicated notification player
    const audioQueue = useRef([]);
    const isSpeaking = useRef(false);

    // --- Core Logic and useEffects ---
    const getLocation = useCallback(() => {
        if (!navigator.geolocation) {
            setStatusMessage("Geolocation is not supported by your browser.");
            return;
        }
        setStatusMessage("Getting your location...");
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = { lat: position.coords.latitude, lng: position.coords.longitude };
                setUserLocation(location);
                setStatusMessage("Location found! Ready to track.");
            },
            () => {
                setStatusMessage("Unable to get location. Using default. Please allow access.");
                setUserLocation({ lat: 10.5925, lng: 76.1555 });
            }
        );
    }, []);
    
    const playNotificationSound = useCallback(() => {
        // Use the dedicated audio element for notifications
        if (notificationPlayerRef.current) {
            notificationPlayerRef.current.currentTime = 0;
            notificationPlayerRef.current.play().catch(e => console.error("Error playing notification sound:", e));
        }
    }, []);

    const mockFetchPlaneData = useCallback(() => {
        if (!userLocation) return;
        setStatusMessage("Generating mock plane data...");

        const mockPlane = {
            icao24: 'mock' + Date.now(),
            callsign: 'MOCK ' + Math.floor(Math.random() * 1000),
            lat: userLocation.lat + (Math.random() - 0.5) * 0.1,
            lon: userLocation.lng + (Math.random() - 0.5) * 0.1,
            altitude_m: (MINIMUM_ALTITUDE_FT + Math.random() * 20000) / 3.28084,
            velocity_ms: 200 + Math.random() * 100,
        };

        const distance = calculateDistance(userLocation.lat, userLocation.lng, mockPlane.lat, mockPlane.lon);
        const newBearing = calculateBearing(userLocation.lat, userLocation.lng, mockPlane.lat, mockPlane.lon);
        const altitudeFt = mockPlane.altitude_m * 3.28084;
        
        setBearing(newBearing);

        if (distance < NOTIFICATION_RADIUS_KM && altitudeFt > MINIMUM_ALTITUDE_FT) {
            if (!detectedPlane || detectedPlane.icao24 !== mockPlane.icao24) {
                setDetectedPlane({ ...mockPlane, altitude_ft: altitudeFt, isMock: true });
                playNotificationSound();
            }
        } else {
            setDetectedPlane(null);
        }
    }, [userLocation, detectedPlane, playNotificationSound]);

    const fetchRealPlaneData = useCallback(async () => {
        if (!userLocation) return;
        setStatusMessage("Scanning the skies for live data...");
        try {
            const response = await fetch(`${API_BASE_URL}/api/planes?lat=${userLocation.lat}&lon=${userLocation.lng}`);
            if (!response.ok) throw new Error(`Backend Error: ${response.statusText}`);
            const data = await response.json();
            
            let closestPlaneForNotification = null;
            let closestPlaneForCompass = null;
            let minDistance = Infinity;
            
            for (const plane of data.planes) {
                const distance = calculateDistance(userLocation.lat, userLocation.lng, plane.lat, plane.lon);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestPlaneForCompass = plane;
                }
                const altitudeFt = plane.altitude_m * 3.28084;
                if (distance < NOTIFICATION_RADIUS_KM && altitudeFt > MINIMUM_ALTITUDE_FT) {
                    closestPlaneForNotification = { ...plane, altitude_ft: altitudeFt };
                }
            }

            if (closestPlaneForCompass) {
                const newBearing = calculateBearing(userLocation.lat, userLocation.lng, closestPlaneForCompass.lat, closestPlaneForCompass.lon);
                setBearing(newBearing);
            }

            if (closestPlaneForNotification) {
                if (!detectedPlane || detectedPlane.icao24 !== closestPlaneForNotification.icao24) {
                    setDetectedPlane({ ...closestPlaneForNotification, isMock: false });
                    playNotificationSound();
                }
            } else {
                setDetectedPlane(null); 
            }
        } catch (error) {
            console.error("Failed to fetch plane data:", error);
            setStatusMessage("Error connecting to server. Is it running?");
        }
    }, [userLocation, detectedPlane, playNotificationSound]);

    useEffect(() => {
        let intervalId = null;
        if (isTracking && userLocation) {
            fetchRealPlaneData();
            intervalId = setInterval(fetchRealPlaneData, TRACKING_INTERVAL_MS);
        }
        return () => { if (intervalId) clearInterval(intervalId); };
    }, [isTracking, userLocation, fetchRealPlaneData]);
    
    useEffect(() => {
        let mockIntervalId = null;
        if (isMockMode && userLocation) {
            mockFetchPlaneData();
            mockIntervalId = setInterval(mockFetchPlaneData, MOCK_TRACKING_INTERVAL_MS);
        }
        return () => { if (mockIntervalId) clearInterval(mockIntervalId); };
    }, [isMockMode, userLocation, mockFetchPlaneData]);

    useEffect(() => {
        let scanningInterval = null;
        if ((isTracking || isMockMode) && !detectedPlane) {
            scanningInterval = setInterval(() => {
                setBearing(prevBearing => (prevBearing + 2) % 360);
            }, 50);
        }
        return () => { if (scanningInterval) clearInterval(scanningInterval); };
    }, [isTracking, isMockMode, detectedPlane]);

    // --- Audio Logic ---
    const stopAllAudio = useCallback(() => {
        if (audioPlayerRef.current) {
            audioPlayerRef.current.pause();
            audioPlayerRef.current.currentTime = 0;
        }
        audioQueue.current = [];
        isSpeaking.current = false;
    }, []);

    const playNextInQueue = useCallback(() => {
        if (audioQueue.current.length === 0) {
            isSpeaking.current = false;
            return;
        }
        isSpeaking.current = true;
        const soundName = audioQueue.current.shift();
        const soundSrc = soundFiles[soundName];
        
        if (soundSrc && audioPlayerRef.current) {
            audioPlayerRef.current.src = soundSrc;
            audioPlayerRef.current.play().catch(e => {
                console.error("Error playing sound:", e);
                isSpeaking.current = false;
            });
        } else {
            playNextInQueue();
        }
    }, []);

    const handleSpeakDirection = useCallback(() => {
        if (isSpeaking.current || !detectedPlane) return;
        stopAllAudio();
        const planeBearing = calculateBearing(userLocation.lat, userLocation.lng, detectedPlane.lat, detectedPlane.lon);
        const phrase = getDirectionPhrase(planeBearing);
        audioQueue.current = [...phrase];
        playNextInQueue();
    }, [detectedPlane, userLocation, playNextInQueue, stopAllAudio]);

    // --- Event Handlers ---
    const handleStartStopClick = () => {
        if (!userLocation) getLocation();
        if (isTracking) {
            stopAllAudio();
            setIsTracking(false);
            setStatusMessage("Tracking stopped.");
        } else {
            stopAllAudio();
            setIsMockMode(false);
            setDetectedPlane(null);
            setIsTracking(true);
            setStatusMessage("Live tracking activated...");
        }
    };

    const handleMockModeClick = () => {
        if (!userLocation) getLocation();
        if (isMockMode) {
            stopAllAudio();
            setIsMockMode(false);
            setStatusMessage("Mock mode stopped.");
        } else {
            stopAllAudio();
            setIsTracking(false);
            setDetectedPlane(null);
            setIsMockMode(true);
            setStatusMessage("Mock mode activated...");
        }
    };
    
    // --- Render ---
    return (
        <main className="w-full min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center p-4 text-center">
            <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-800 tracking-tight">V-Compass</h1>
            <p className="mt-2 text-gray-500">{statusMessage}</p>
            
            <div className="my-8"><Compass bearing={bearing} /></div>
            
            <div className="flex space-x-4">
                <button
                    onClick={handleStartStopClick}
                    className={`px-8 py-4 text-lg font-bold text-white rounded-full shadow-lg transition-all transform hover:scale-105 ${
                        isTracking ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                    }`}
                >
                    {isTracking ? 'Stop Tracking' : 'Start Live Tracking'}
                </button>
                <button
                    onClick={handleMockModeClick}
                    className={`px-8 py-4 text-lg font-bold text-white rounded-full shadow-lg transition-all transform hover:scale-105 ${
                        isMockMode ? 'bg-red-500 hover:bg-red-600' : 'bg-purple-500 hover:bg-purple-600'
                    }`}
                >
                    {isMockMode ? 'Stop Mock Mode' : 'Activate Mock Mode'}
                </button>
            </div>

            <PlaneNotification 
                plane={detectedPlane} 
                onSpeakDirection={handleSpeakDirection} 
            />

            {/* Player for the directional voice queue */}
            <audio 
                ref={audioPlayerRef} 
                onEnded={playNextInQueue} 
                hidden 
            />

            {/* Dedicated, pre-loaded player for notifications to ensure smooth playback */}
            <audio 
                ref={notificationPlayerRef} 
                src={soundFiles.notification} 
                hidden 
            />
        </main>
    );
}