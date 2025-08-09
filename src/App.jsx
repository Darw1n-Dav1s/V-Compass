import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- Configuration ---
const NOTIFICATION_RADIUS_KM = 5;
const MINIMUM_ALTITUDE_FT = 10000;
const TRACKING_INTERVAL_MS = 4000; // Check for planes every 4 seconds

// --- Helper Functions (Calculations) ---
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
    if (bearing > 22.5 && bearing <= 67.5) return ["between", "North", "and", "East"];
    if (bearing > 67.5 && bearing <= 112.5) return ["East"];
    if (bearing > 112.5 && bearing <= 157.5) return ["between", "East", "and", "South"];
    if (bearing > 157.5 && bearing <= 202.5) return ["South"];
    if (bearing > 202.5 && bearing <= 247.5) return ["between", "South", "and", "West"];
    if (bearing > 247.5 && bearing <= 292.5) return ["West"];
    if (bearing > 292.5 && bearing <= 337.5) return ["between", "West", "and", "North"];
    return [];
};


// --- React Components ---

/**
 * The Compass Component
 * A presentational component that displays the compass and needle.
 * @param {number} bearing - The direction in degrees (0-360) for the needle to point.
 */
const Compass = ({ bearing }) => {
    return (
        <div className="relative w-64 h-64 sm:w-80 sm:h-80 rounded-full bg-gray-200 border-8 border-gray-300 shadow-lg flex items-center justify-center">
            {/* Cardinal Direction Markers */}
            <span className="absolute top-2 text-xl font-bold text-gray-600">N</span>
            <span className="absolute bottom-2 text-xl font-bold text-gray-600">S</span>
            <span className="absolute left-5 text-xl font-bold text-gray-600">W</span>
            <span className="absolute right-5 text-xl font-bold text-gray-600">E</span>
            
            {/* Compass Needle */}
            <div 
                className="absolute w-0 h-0"
                style={{
                    borderLeft: '1rem solid transparent',
                    borderRight: '1rem solid transparent',
                    borderBottom: '8rem solid #ef4444', // Tailwind's red-500
                    top: '1rem',
                    transformOrigin: 'bottom center',
                    transition: 'transform 0.7s cubic-bezier(0.68, -0.55, 0.27, 1.55)', // Funky transition
                    transform: `rotate(${bearing}deg)`,
                }}
            />
            <div className="w-4 h-4 bg-gray-800 rounded-full z-10"></div>
        </div>
    );
};

/**
 * The Notification Component
 * Displays information about the detected plane. Only renders if a plane is passed to it.
 * @param {object} plane - The data for the detected plane.
 * @param {function} onSpeakDirection - Callback to trigger the audio direction.
 */
const PlaneNotification = ({ plane, onSpeakDirection }) => {
    if (!plane) return null;

    return (
        <div className="w-full max-w-md p-4 mt-8 bg-white rounded-xl shadow-2xl animate-fade-in-up border border-blue-200">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-800">✈️ Plane Detected Overhead!</h3>
                <span className="px-2 py-1 text-xs font-semibold text-green-800 bg-green-200 rounded-full">
                    LIVE
                </span>
            </div>
            <p className="mt-2 text-gray-600">
                Look up! Flight <span className="font-bold">{plane.callsign || 'N/A'}</span> is passing by.
            </p>
            <ul className="mt-3 text-sm text-gray-500">
                <li><strong>Altitude:</strong> {Math.round(plane.altitude)} ft</li>
                <li><strong>Speed:</strong> {Math.round(plane.velocity * 1.944)} knots</li>
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

/**
 * The Main App Component
 */
export default function App() {
    // --- State Management ---
    const [isTracking, setIsTracking] = useState(false);
    const [userLocation, setUserLocation] = useState(null);
    const [detectedPlane, setDetectedPlane] = useState(null);
    const [bearing, setBearing] = useState(0);
    const [statusMessage, setStatusMessage] = useState("Click 'Start Tracking' to begin.");
    
    // --- Refs for Audio (with updated, reliable sound sources) ---
    const notificationSoundRef = useRef(new Audio("https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg"));
    const audioRefs = useRef({
        // Using generic, reliable sounds from Google's library to fix the error.
        // For custom sounds, place your MP3s in the /public folder of your React project
        // and use paths like "/north.mp3", "/south.mp3", etc.
        North: new Audio("https://actions.google.com/sounds/v1/beeps/beep_short.ogg"),
        South: new Audio("https://actions.google.com/sounds/v1/beeps/beep_short.ogg"),
        East: new Audio("https://actions.google.com/sounds/v1/beeps/beep_short.ogg"),
        West: new Audio("https://actions.google.com/sounds/v1/beeps/beep_short.ogg"),
        between: new Audio("https://actions.google.com/sounds/v1/beeps/quick_double_beep.ogg"),
        and: new Audio("https://actions.google.com/sounds/v1/beeps/quick_double_beep.ogg"),
    });
    const audioQueue = useRef([]);
    const isSpeaking = useRef(false);

    // --- Core Logic ---

    // Function to get user's location
    const getLocation = useCallback(() => {
        if (!navigator.geolocation) {
            setStatusMessage("Geolocation is not supported by your browser.");
            return;
        }
        setStatusMessage("Getting your location...");
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setUserLocation({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                });
                setStatusMessage("Location found! Ready to track.");
            },
            () => {
                setStatusMessage("Unable to get location. Please allow access.");
                // Default to a known location if denied
                setUserLocation({ lat: 10.5925, lng: 76.1555 });
            }
        );
    }, []);

    // MOCK FUNCTION: Simulates fetching plane data from a backend
    const mockFetchPlaneData = useCallback(() => {
        if (!userLocation) return;

        // Create a fake plane that moves across the user's location
        const mockPlane = {
            icao24: 'mock' + Date.now(),
            callsign: 'SKYFUN ' + Math.floor(Math.random() * 100),
            lat: userLocation.lat + (Math.random() - 0.5) * 0.1, // Closer range for testing
            lon: userLocation.lng + (Math.random() - 0.5) * 0.1,
            altitude: MINIMUM_ALTITUDE_FT + Math.random() * 20000,
            velocity: 200 + Math.random() * 100, // m/s
        };

        const distance = calculateDistance(userLocation.lat, userLocation.lng, mockPlane.lat, mockPlane.lon);
        const newBearing = calculateBearing(userLocation.lat, userLocation.lng, mockPlane.lat, mockPlane.lon);
        
        setBearing(newBearing); // Always update bearing for the compass

        // Check if the plane is within the notification zone
        if (distance < NOTIFICATION_RADIUS_KM && mockPlane.altitude > MINIMUM_ALTITUDE_FT) {
            // Only trigger notification for a new plane
            if (!detectedPlane || detectedPlane.icao24 !== mockPlane.icao24) {
                setDetectedPlane(mockPlane);
                notificationSoundRef.current.play().catch(e => console.error("Error playing notification sound:", e));
            }
        } else {
            setDetectedPlane(null); // Plane is out of range
        }
    }, [userLocation, detectedPlane]);

    // Effect to manage the tracking interval
    useEffect(() => {
        let intervalId = null;
        if (isTracking && userLocation) {
            intervalId = setInterval(mockFetchPlaneData, TRACKING_INTERVAL_MS);
            setStatusMessage("Scanning the skies...");
        } else if (!isTracking && statusMessage !== "Click 'Start Tracking' to begin.") {
             setStatusMessage("Tracking stopped.");
        }
        // Cleanup function
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [isTracking, userLocation, mockFetchPlaneData, statusMessage]);
    
    // --- Audio Queue Logic ---
    const playNextInQueue = useCallback(() => {
        if (audioQueue.current.length === 0) {
            isSpeaking.current = false;
            return;
        }
        isSpeaking.current = true;
        const audio = audioRefs.current[audioQueue.current.shift()];
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => console.error("Error playing direction sound:", e));
            audio.onended = playNextInQueue;
        } else {
            playNextInQueue();
        }
    }, []);

    const handleSpeakDirection = useCallback(() => {
        if (isSpeaking.current) return;
        const phrase = getDirectionPhrase(bearing);
        audioQueue.current = [...phrase];
        playNextInQueue();
    }, [bearing, playNextInQueue]);

    // --- Event Handlers ---
    const handleStartStopClick = () => {
        if (!userLocation) {
            getLocation();
        }
        // Request notification permission if not granted
        if (Notification.permission !== "granted") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    setIsTracking(prev => !prev);
                } else {
                    alert("Notification permission is needed for alerts!");
                }
            });
        } else {
            setIsTracking(prev => !prev);
        }
    };
    
    // --- Render ---
    return (
        <main className="w-full min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center p-4 text-center">
            <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-800 tracking-tight">
                SkyPing
            </h1>
            <p className="mt-2 text-gray-500">{statusMessage}</p>
            
            <div className="my-8">
                <Compass bearing={bearing} />
            </div>
            
            <button
                onClick={handleStartStopClick}
                className={`px-8 py-4 text-lg font-bold text-white rounded-full shadow-lg transition-all transform hover:scale-105 ${
                    isTracking ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                }`}
            >
                {isTracking ? 'Stop Tracking' : 'Start Tracking'}
            </button>

            <PlaneNotification 
                plane={detectedPlane} 
                onSpeakDirection={handleSpeakDirection} 
            />
        </main>
    );
}
