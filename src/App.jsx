import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- Configuration ---
const API_BASE_URL = "http://127.0.0.1:8000"; // Your FastAPI backend URL
const NOTIFICATION_RADIUS_KM = 30; // Increased radius for more likely hits
const MINIMUM_ALTITUDE_FT = 10000;
const TRACKING_INTERVAL_MS = 10000; // Check every 10 seconds to respect API rate limits

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
                    transition: 'transform 0.7s cubic-bezier(0.68, -0.55, 0.27, 1.55)',
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
                <span className="px-2 py-1 text-xs font-semibold text-green-800 bg-green-200 rounded-full">
                    LIVE
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

// --- The Main App Component ---
export default function App() {
    const [isTracking, setIsTracking] = useState(false);
    const [userLocation, setUserLocation] = useState(null);
    const [detectedPlane, setDetectedPlane] = useState(null);
    const [bearing, setBearing] = useState(0);
    const [statusMessage, setStatusMessage] = useState("Click 'Start Tracking' to begin.");
    
    const notificationSoundRef = useRef(new Audio("https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg"));
    const audioRefs = useRef({
        North: new Audio("https://actions.google.com/sounds/v1/beeps/beep_short.ogg"),
        South: new Audio("https://actions.google.com/sounds/v1/beeps/beep_short.ogg"),
        East: new Audio("https://actions.google.com/sounds/v1/beeps/beep_short.ogg"),
        West: new Audio("https://actions.google.com/sounds/v1/beeps/beep_short.ogg"),
        between: new Audio("https://actions.google.com/sounds/v1/beeps/quick_double_beep.ogg"),
        and: new Audio("https://actions.google.com/sounds/v1/beeps/quick_double_beep.ogg"),
    });
    const audioQueue = useRef([]);
    const isSpeaking = useRef(false);

    const getLocation = useCallback(() => {
        if (!navigator.geolocation) {
            setStatusMessage("Geolocation is not supported by your browser.");
            return;
        }
        setStatusMessage("Getting your location...");
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                setUserLocation(location);
                setStatusMessage("Location found! Ready to track.");
                console.log("User location:", location);
            },
            () => {
                setStatusMessage("Unable to get location. Please allow access.");
                setUserLocation({ lat: 10.5925, lng: 76.1555 }); // Default fallback
            }
        );
    }, []);

    // --- REAL-TIME DATA FETCHING ---
    const fetchRealPlaneData = useCallback(async () => {
        if (!userLocation) return;

        setStatusMessage("Scanning the skies to find your happiness...");
        try {
            const response = await fetch(`${API_BASE_URL}/api/planes?lat=${userLocation.lat}&lon=${userLocation.lng}`);
            if (!response.ok) {
                throw new Error(`Backend Error: ${response.statusText}`);
            }
            const data = await response.json();
            
            let closestPlaneForNotification = null;
            let closestPlaneForCompass = null;
            let minDistance = Infinity;
            
            for (const plane of data.planes) {
                const distance = calculateDistance(userLocation.lat, userLocation.lng, plane.lat, plane.lon);
                
                // Track the absolute closest plane for the compass
                if (distance < minDistance) {
                    minDistance = distance;
                    closestPlaneForCompass = plane;
                }

                // Check if this plane is a candidate for notification
                const altitudeFt = plane.altitude_m * 3.28084;
                if (distance < NOTIFICATION_RADIUS_KM && altitudeFt > MINIMUM_ALTITUDE_FT) {
                    closestPlaneForNotification = { ...plane, altitude_ft: altitudeFt };
                }
            }

            // Update compass to point to the nearest plane, regardless of notification status
            if (closestPlaneForCompass) {
                const newBearing = calculateBearing(userLocation.lat, userLocation.lng, closestPlaneForCompass.lat, closestPlaneForCompass.lon);
                setBearing(newBearing);
            }

            // Update notification plane
            if (closestPlaneForNotification) {
                // Trigger notification only for a new plane
                if (!detectedPlane || detectedPlane.icao24 !== closestPlaneForNotification.icao24) {
                    console.log("New plane detected:", closestPlaneForNotification);
                    setDetectedPlane(closestPlaneForNotification);
                    notificationSoundRef.current.play().catch(e => console.error("Error playing sound:", e));
                }
            } else {
                setDetectedPlane(null); // No plane in notification range
            }

        } catch (error) {
            console.error("Failed to fetch plane data:", error);
            setStatusMessage("Error connecting to server. Is it running?");
        }
    }, [userLocation, detectedPlane]);

        // --- Mock Mode ---
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
                notificationSoundRef.current.play().catch(e => console.error("Error playing sound:", e));
            }
        } else {
            setDetectedPlane(null);
        }
    }, [userLocation, detectedPlane]);

    // --- Effect to manage the tracking interval ---
    useEffect(() => {
        let intervalId = null;
        if (isTracking && userLocation) {
            fetchRealPlaneData(); // Fetch immediately on start
            intervalId = setInterval(fetchRealPlaneData, TRACKING_INTERVAL_MS);
            setStatusMessage("Scanning the skies...");
        } else if (!isTracking) {
             setStatusMessage("Tracking stopped.");
        }
        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [isTracking, userLocation, fetchRealPlaneData]);
    
    // // --- Effect for the "scanning" animation ---
    // useEffect(() => {
    //     let scanningInterval = null;
    //     // Only run the animation if we are tracking but have NOT detected a plane.
    //     if (isTracking && !detectedPlane) {
    //         scanningInterval = setInterval(() => {
    //             // Rotate the needle by 2 degrees every 50ms
    //             setBearing(prevBearing => (prevBearing + 0.12) % 360);
    //         }, 20);
    //     }
    //     // This cleanup function is crucial. It stops the animation
    //     // as soon as a plane is detected or tracking is stopped.
    //     return () => {
    //         if (scanningInterval) {
    //             clearInterval(scanningInterval);
    //         }
    //     };
    // }, [isTracking, detectedPlane]);

    useEffect(() => {
    let animationFrameId;
    let lastTime = null;

    const rotateNeedle = (time) => {
        if (!lastTime) lastTime = time;
        const delta = (time - lastTime) / 1000;
        lastTime = time;

        // Very slow: 2 degrees per second (3 minutes per full rotation)
        setBearing(prev => (prev + delta * 2) % 360);

        if (isTracking && !detectedPlane) {
            animationFrameId = requestAnimationFrame(rotateNeedle);
        }
    };

    if (isTracking && !detectedPlane) {
        animationFrameId = requestAnimationFrame(rotateNeedle);
    }

    return () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
    }, [isTracking, detectedPlane]);

    


    // --- Audio Queue Logic  ---
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
        if (isSpeaking.current || !detectedPlane) return;
        const planeBearing = calculateBearing(userLocation.lat, userLocation.lng, detectedPlane.lat, detectedPlane.lon);
        const phrase = getDirectionPhrase(planeBearing);
        audioQueue.current = [...phrase];
        playNextInQueue();
    }, [bearing, playNextInQueue, detectedPlane, userLocation]);

    // --- Event Handlers (unchanged) ---
    const handleStartStopClick = () => {
        if (!userLocation) {
            getLocation();
        }
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
    
    // --- Render (unchanged) ---
    return (
        <main className="w-full min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center p-4 text-center">
            <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-800 tracking-tight py-5">
                V-Compass
            </h1>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-700 tracking-tight py-5">
                Vimaanam Compass to find your happiness
            </h2>
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