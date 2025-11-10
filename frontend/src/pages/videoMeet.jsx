import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import {
  Badge,
  IconButton,
  TextField,
  Button,
  Drawer,
  List,
  ListItem,
  ListItemText,
  Typography,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
} from "@mui/material";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import CallEndIcon from "@mui/icons-material/CallEnd";
import ChatIcon from "@mui/icons-material/Chat";
import SendIcon from "@mui/icons-material/Send";
import PeopleIcon from "@mui/icons-material/People";
import PanToolAltIcon from "@mui/icons-material/PanToolAlt";
import SubtitlesIcon from "@mui/icons-material/Subtitles";
import styles from "../styles/videoComponent.module.css";

const SERVER_URL = "http://localhost:8000";
const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const makePeerContainer = (pc) => ({ pc, pendingCandidates: [] });

export default function VideoMeetComponent() {
  const socketRef = useRef(null);
  const peersRef = useRef({});
  const peerMetaRef = useRef({}); // socketId -> { name, handRaised }
  const localVideoRef = useRef(null); // preview before join
  const meetingVideoRef = useRef(null); // self-view inside meeting

  const [localStream, setLocalStream] = useState(null);
  const [username, setUsername] = useState("");
  const [askName, setAskName] = useState(true);
  const [remoteVideos, setRemoteVideos] = useState([]); // [{ id, name, stream }]
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [newMessages, setNewMessages] = useState(0);
  const [videoOn, setVideoOn] = useState(true);
  const [audioOn, setAudioOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [meetingId, setMeetingId] = useState("");
  const [handRaised, setHandRaised] = useState(false);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [timer, setTimer] = useState(0);

  const [captions, setCaptions] = useState({});
  const [listening, setListening] = useState(true); // TTS on by default for blind chat
  const [shareCaptions, setShareCaptions] = useState(false);
  const [targetLang, setTargetLang] = useState("en");
  const recognitionRef = useRef(null);

  // Active speaker id for highlighting (socket id or "local")
  const [activeSpeakerId, setActiveSpeakerId] = useState(null);

  // store analyser nodes / intervals per stream to stop later
  const audioMonitors = useRef({}); // id -> { ctx, analyser, interval }
  const activeSpeakerTimeouts = useRef({}); // id -> timeout handle for debouncing

  useEffect(() => {
    let interval;
    if (!askName) interval = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [askName]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // get local media
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!mounted) return;
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        // start local audio monitor so we can highlight when speaking
        startMonitorForStream(stream, "local");
      } catch (err) {
        console.error("Cannot access camera/mic:", err);
        alert("Please allow camera and microphone access.");
      }
    })();

    return () => {
      mounted = false;
      // stop monitors
      Object.values(audioMonitors.current).forEach((m) => {
        clearInterval(m.interval);
        try { m.ctx.close(); } catch { }
      });
      localStream?.getTracks().forEach((t) => t.stop());
      Object.values(peersRef.current).forEach((c) => c.pc.close());
      socketRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ensure meeting self-view also shows localStream (prevents black)
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream ?? null;
    if (meetingVideoRef.current) meetingVideoRef.current.srcObject = localStream ?? null;
  }, [localStream, askName]); // Re-run when askName changes to connect meetingVideoRef after join

  const safeParse = (s) => {
    try {
      return typeof s === "string" ? JSON.parse(s) : s;
    } catch {
      return null;
    }
  };

  // -----------------------
  // Socket + signaling
  // -----------------------
  const connect = () => {
    if (!username.trim()) return alert("Please enter your name first");
    if (!localStream) return alert("Waiting for camera/mic access...");

    const roomId =
      window.location.pathname.replace("/", "") || Math.random().toString(36).slice(2, 8);
    setMeetingId(roomId);
    setAskName(false);

    socketRef.current = io(SERVER_URL, { transports: ["websocket"] });

    socketRef.current.on("connect", () => {
      socketRef.current.emit("join-call", { roomId, username });
    });

    socketRef.current.on("existing-users", (users) => {
      users.forEach((u) => {
        peerMetaRef.current[u.id] = { name: u.username, handRaised: false };
        createOfferTo(u.id);
      });
    });

    socketRef.current.on("user-joined", ({ id, username: name }) => {
      peerMetaRef.current[id] = { name, handRaised: false };
    });

    socketRef.current.on("signal", async (fromId, message) => {
      if (!fromId || !message) return;
      if (!peersRef.current[fromId]) createPeerAsResponder(fromId);
      const container = peersRef.current[fromId];
      const pc = container.pc;
      const data = safeParse(message) || message;

      if (data?.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current.emit("signal", fromId, pc.localDescription);
        await flushPendingCandidates(fromId);
        return;
      }
      if (data?.type === "answer") {
        if (!pc.remoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          await flushPendingCandidates(fromId);
        }
        return;
      }
      if (data?.candidate) {
        if (!pc.remoteDescription) container.pendingCandidates.push(data.candidate);
        else await pc.addIceCandidate(data.candidate);
      }
    });

    socketRef.current.on("user-left", (id) => {
      if (peersRef.current[id]) {
        peersRef.current[id].pc.close();
        delete peersRef.current[id];
      }
      // stop audio monitor for that user
      stopMonitorForId(id);
      setRemoteVideos((prev) => prev.filter((v) => v.id !== id));
      delete peerMetaRef.current[id];
    });

    // Incoming chat: speak if listening and create AI temporary reply
    socketRef.current.on("chat-message", (data, sender) => {
      setMessages((m) => [...m, { sender, text: data }]);
      if (!chatOpen) setNewMessages((n) => n + 1);

      // speak incoming message for blind users
      if (listening) {
        speakText(`${sender} says ${data}`);
      }

      // temporary client-side AI reply (simulate)
      if (sender !== "AI-assistant" && sender !== username) {
        // simple rules: if message contains "summary" reply summarizing, else echo
        setTimeout(() => {
          const aiReply =
            /summary/i.test(data)
              ? `AI: Short summary of "${data.slice(0, 80)}"...`
              : `AI: I heard "${data.length > 120 ? data.slice(0, 120) + "..." : data}"`;
          setMessages((m) => [...m, { sender: "AI-assistant", text: aiReply }]);
          if (listening) speakText(`Assistant says ${aiReply}`);
        }, 800 + Math.random() * 800);
      }
    });

    socketRef.current.on("hand-raised", ({ name, raised }) => {
      const id = Object.keys(peerMetaRef.current).find((k) => peerMetaRef.current[k].name === name);
      if (id) {
        peerMetaRef.current[id].handRaised = raised;
        setRemoteVideos((v) => [...v]); // trigger rerender
      }
    });

    // captions arrive: show + speak + highlight
    socketRef.current.on("caption", ({ sender, text }) => {
      if (!listening) return;
      setCaptions((prev) => ({ ...prev, [sender]: `${sender}: ${text}` }));

      // speak caption
      speakText(`${sender} says ${text}`);

      // highlight speaker (find id by name)
      const id = Object.keys(peerMetaRef.current).find((k) => peerMetaRef.current[k].name === sender);
      if (id) {
        setActiveSpeakerId(id);
        setTimeout(() => {
          setActiveSpeakerId(null);
        }, 3000);
      } else {
        // if it's local
        if (sender === username) {
          setActiveSpeakerId("local");
          setTimeout(() => setActiveSpeakerId(null), 3000);
        }
      }

      // remove caption after few seconds
      setTimeout(() => {
        setCaptions((prev) => {
          const c = { ...prev };
          delete c[sender];
          return c;
        });
      }, 4000);
    });
  };

  // -----------------------
  // WebRTC helpers
  // -----------------------
  const createPeerAsResponder = (remoteId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    addLocalTracks(pc);
    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current.emit("signal", remoteId, { candidate: e.candidate });
    };
    pc.ontrack = (ev) => handleRemoteTrack(remoteId, ev);
    peersRef.current[remoteId] = makePeerContainer(pc);
    return pc;
  };

  const createOfferTo = async (remoteId) => {
    if (peersRef.current[remoteId]) return;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    addLocalTracks(pc);
    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current.emit("signal", remoteId, { candidate: e.candidate });
    };
    pc.ontrack = (ev) => handleRemoteTrack(remoteId, ev);
    peersRef.current[remoteId] = makePeerContainer(pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit("signal", remoteId, pc.localDescription);
  };

  const addLocalTracks = (pc) => {
    localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream));
  };

  const handleRemoteTrack = (remoteId, ev) => {
    const [stream] = ev.streams;
    const name = peerMetaRef.current[remoteId]?.name || "Peer";
    setRemoteVideos((prev) => {
      if (prev.some((p) => p.id === remoteId)) {
        return prev.map((p) => (p.id === remoteId ? { ...p, stream, name } : p));
      }
      return [...prev, { id: remoteId, name, stream }];
    });

    // start monitoring this remote stream for activity (speaker detection)
    startMonitorForStream(stream, remoteId);
  };

  const flushPendingCandidates = async (remoteId) => {
    const container = peersRef.current[remoteId];
    if (!container) return;
    while (container.pendingCandidates.length) {
      const cand = container.pendingCandidates.shift();
      await container.pc.addIceCandidate(cand);
    }
  };

  // -----------------------
  // Chat send (with temporary AI reply)
  // -----------------------
  const sendMessage = () => {
    if (!message.trim()) return;
    socketRef.current.emit("chat-message", message, username);
    setMessages((m) => [...m, { sender: "You", text: message }]);
    // speak own sent message optionally (user may want it)
    if (listening) speakText(`You said ${message}`);
    // temporary local AI response (no backend)
    setTimeout(() => {
      const ai = /help|how|what/i.test(message)
        ? `AI-assistant: I can help — try saying "summarize" or ask a specific question.`
        : `AI-assistant: I heard "${message.length > 100 ? message.slice(0, 100) + "..." : message}"`;
      setMessages((m) => [...m, { sender: "AI-assistant", text: ai }]);
      if (listening) speakText(ai.replace(/^AI-assistant:\s*/, ""));
    }, 700 + Math.random() * 700);

    setMessage("");
  };

  // -----------------------
  // Raise Hand
  // -----------------------
  const raiseHand = () => {
    const newState = !handRaised;
    setHandRaised(newState);
    socketRef.current.emit("hand-raised", { name: username, raised: newState });
  };

  // -----------------------
  // Audio monitoring (simple volume-based speaker detection)
  // -----------------------
  const startMonitorForStream = (stream, id) => {
    try {
      // don't re-create monitor if exists
      if (audioMonitors.current[id]) return;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let currentSpeakingState = false; // Track local state to avoid unnecessary updates

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        // compute simple RMS-ish volume
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        // threshold tuned roughly; you may adjust
        const isSpeaking = avg > 20;

        if (isSpeaking && !currentSpeakingState) {
          // Started speaking
          currentSpeakingState = true;
          // Clear any existing timeout for this speaker
          if (activeSpeakerTimeouts.current[id]) {
            clearTimeout(activeSpeakerTimeouts.current[id]);
            delete activeSpeakerTimeouts.current[id];
          }
          // Only update if not already the active speaker (avoid re-render)
          setActiveSpeakerId((current) => {
            if (current !== id) return id;
            return current;
          });
        } else if (!isSpeaking && currentSpeakingState) {
          // Stopped speaking
          currentSpeakingState = false;
          // Debounce: wait before clearing active speaker
          if (activeSpeakerTimeouts.current[id]) {
            clearTimeout(activeSpeakerTimeouts.current[id]);
          }
          activeSpeakerTimeouts.current[id] = setTimeout(() => {
            setActiveSpeakerId((current) => {
              if (current === id) return null;
              return current;
            });
            delete activeSpeakerTimeouts.current[id];
          }, 500);
        }
      }, 300); // Increased from 200ms to 300ms to reduce frequency

      audioMonitors.current[id] = { ctx, analyser, interval, source };
    } catch (err) {
      // some browsers block AudioContext until user interaction
      // it's okay to silently fail
      console.warn("Audio monitor failed for", id, err);
    }
  };

  const stopMonitorForId = (id) => {
    const m = audioMonitors.current[id];
    if (!m) return;
    clearInterval(m.interval);
    try {
      m.ctx.close();
    } catch { }
    delete audioMonitors.current[id];

    // Clear any pending timeout for this speaker
    if (activeSpeakerTimeouts.current[id]) {
      clearTimeout(activeSpeakerTimeouts.current[id]);
      delete activeSpeakerTimeouts.current[id];
    }
  };

  // -----------------------
  // Text-to-Speech helper
  // -----------------------
  const speakText = (text) => {
    if (!listening) return;
    if (!("speechSynthesis" in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = targetLang === "hi" ? "hi-IN" : "en-US";
      u.rate = 1;
      window.speechSynthesis.cancel(); // prevent queue piling
      window.speechSynthesis.speak(u);
    } catch (err) {
      console.warn("TTS error:", err);
    }
  };

  // -----------------------
  // Screen share
  // -----------------------
  const toggleScreenShare = async () => {
    if (!screenOn) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        Object.values(peersRef.current).forEach(({ pc }) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) sender.replaceTrack(screenTrack);
        });
        if (meetingVideoRef.current) meetingVideoRef.current.srcObject = screenStream;
        screenTrack.onended = () => toggleScreenShare();
        setScreenOn(true);
      } catch (err) {
        console.error("Screen share failed:", err);
        alert("Screen share failed or denied.");
      }
    } else {
      // switch back to camera
      const camTrack = localStream?.getVideoTracks()[0];
      if (camTrack) {
        Object.values(peersRef.current).forEach(({ pc }) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) sender.replaceTrack(camTrack);
        });
        if (meetingVideoRef.current) meetingVideoRef.current.srcObject = localStream;
      }
      setScreenOn(false);
    }
  };

  // -----------------------
  // Toggle audio/video
  // -----------------------
  const toggleAudio = () => {
    const s = !audioOn;
    setAudioOn(s);
    localStream?.getAudioTracks().forEach((t) => (t.enabled = s));
  };

  const toggleVideo = () => {
    const s = !videoOn;
    setVideoOn(s);
    // keep srcObject but disable track so video visually freezes but stays visible
    localStream?.getVideoTracks().forEach((t) => (t.enabled = s));
  };

  // -----------------------
  // Captions share (speech recognition)
  // -----------------------
  useEffect(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return;

    if (shareCaptions) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = targetLang === "hi" ? "hi-IN" : "en-US";

      recognition.onresult = (e) => {
        let final = "";
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript;
        }
        if (final.trim()) {
          socketRef.current?.emit("caption", { sender: username, text: final });
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      return () => recognition.stop();
    } else {
      recognitionRef.current?.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareCaptions, username, targetLang]);

  // -----------------------
  // Render
  // -----------------------
  return (
    <div className={styles.container}>
      {askName ? (
        <div style={{ padding: 20 }}>
          <h2>Join Meeting</h2>
          <TextField value={username} onChange={(e) => setUsername(e.target.value)} label="Your Name" sx={{ mb: 2 }} />
          <Button onClick={connect} variant="contained">Join</Button>
          <div style={{ marginTop: 16 }}>
            <video ref={localVideoRef} autoPlay muted playsInline width={320} height={240} style={{ borderRadius: 8 }} />
          </div>
        </div>
      ) : (
        <div className={styles.meetVideoContainer}>
          <div className={styles.controlBar}>
            <Typography variant="subtitle1">Meeting ID: {meetingId}</Typography>
            <Typography variant="subtitle2">{formatTime(timer)}</Typography>

            <IconButton onClick={toggleAudio}>{audioOn ? <MicIcon /> : <MicOffIcon />}</IconButton>
            <IconButton onClick={toggleVideo}>{videoOn ? <VideocamIcon /> : <VideocamOffIcon />}</IconButton>
            <IconButton onClick={toggleScreenShare}>{screenOn ? <StopScreenShareIcon /> : <ScreenShareIcon />}</IconButton>
            <IconButton onClick={raiseHand} color={handRaised ? "warning" : "default"}><PanToolAltIcon /></IconButton>

            <IconButton onClick={() => setListening((l) => !l)} color={listening ? "success" : "default"}><SubtitlesIcon /></IconButton>
            <IconButton onClick={() => setShareCaptions((s) => !s)} color={shareCaptions ? "warning" : "default"}><SubtitlesIcon /></IconButton>

            <Select size="small" value={targetLang} onChange={(e) => setTargetLang(e.target.value)} sx={{ ml: 1, minWidth: 100 }}>
              <MenuItem value="en">English</MenuItem>
              <MenuItem value="hi">Hindi</MenuItem>
            </Select>

            <IconButton onClick={() => setParticipantsOpen(true)}><PeopleIcon /></IconButton>

            <Badge badgeContent={newMessages} color="secondary">
              <IconButton onClick={() => { setChatOpen(true); setNewMessages(0); }}><ChatIcon /></IconButton>
            </Badge>

            <IconButton onClick={() => setLeaveDialog(true)} color="error"><CallEndIcon /></IconButton>
          </div>

          <div className={styles.videosGrid}>
            {/* Self view */}
            <div
              className={styles.videoBox}
              id="video-local"
              style={{
                boxShadow: activeSpeakerId === "local" ? "0 0 18px 4px #4caf50" : undefined,
              }}
            >
              <video ref={meetingVideoRef} autoPlay muted playsInline className={styles.videoElement} />
              <span className={styles.usernameTag}>
                {username} (You)
                {handRaised && " ✋"}
              </span>
              {captions[username] && <div className={styles.captionBox}>{captions[username]}</div>}
            </div>

            {/* Remote peers */}
            {remoteVideos.map((v) => (
              <div
                key={v.id}
                id={`video-${v.id}`}
                className={styles.videoBox}
                style={{ boxShadow: activeSpeakerId === v.id ? "0 0 18px 4px #ffd54f" : undefined }}
              >
                <video
                  ref={(r) => r && (r.srcObject = v.stream)}
                  autoPlay
                  playsInline
                  className={styles.videoElement}
                />
                <span className={styles.usernameTag}>
                  {v.name}
                  {peerMetaRef.current[v.id]?.handRaised && " ✋"}
                </span>
                {captions[v.name] && <div className={styles.captionBox}>{captions[v.name]}</div>}
              </div>
            ))}
          </div>

          {/* Chat Drawer */}
          <Drawer anchor="right" open={chatOpen} onClose={() => setChatOpen(false)}>
            <div style={{ width: 320, padding: 16, display: "flex", flexDirection: "column", height: "100%" }}>
              <Typography variant="h6" gutterBottom>Chat</Typography>
              <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
                {messages.map((m, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <Typography variant="body2" sx={{ fontWeight: m.sender === "You" ? "bold" : "normal" }}>
                      {m.sender}: {m.text}
                    </Typography>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <TextField value={message} onChange={(e) => setMessage(e.target.value)} fullWidth size="small" placeholder="Type message..." onKeyDown={(e) => e.key === "Enter" && sendMessage()} />
                <IconButton color="primary" onClick={sendMessage}><SendIcon /></IconButton>
              </div>
            </div>
          </Drawer>

          {/* Participants Drawer */}
          <Drawer anchor="left" open={participantsOpen} onClose={() => setParticipantsOpen(false)}>
            <div style={{ width: 260, padding: 16 }}>
              <Typography variant="h6">Participants</Typography>
              <List>
                <ListItem>
                  <ListItemText primary={`${username} (You) ${handRaised ? "✋" : ""}`} />
                </ListItem>
                {Object.values(peerMetaRef.current).map((p, i) => (
                  <ListItem key={i}>
                    <ListItemText primary={`${p.name} ${p.handRaised ? "✋" : ""}`} />
                  </ListItem>
                ))}
              </List>
            </div>
          </Drawer>

          {/* Leave Confirmation */}
          <Dialog open={leaveDialog} onClose={() => setLeaveDialog(false)}>
            <DialogTitle>Leave Meeting?</DialogTitle>
            <DialogContent>
              <Typography>Are you sure you want to leave the meeting?</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setLeaveDialog(false)}>Cancel</Button>
              <Button color="error" onClick={() => { Object.values(peersRef.current).forEach(({ pc }) => pc.close()); localStream?.getTracks().forEach((t) => t.stop()); socketRef.current?.disconnect(); window.location.href = "/"; }}>Leave</Button>
            </DialogActions>
          </Dialog>
        </div>
      )}
    </div>
  );
}
