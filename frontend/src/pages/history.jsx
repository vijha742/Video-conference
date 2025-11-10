import React, { useContext, useEffect, useState } from "react";
import { AuthContext } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  CardActionArea,
  IconButton,
  Typography,
  CircularProgress,
} from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";

export default function History() {
  const { getHistoryOfUser } = useContext(AuthContext);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history = await getHistoryOfUser();
        console.log("Fetched history:", history); // ✅ check what comes back

        // ✅ Always make sure it's an array before setting
        if (Array.isArray(history)) {
          setMeetings(history);
        } else if (history && Array.isArray(history.meetings)) {
          setMeetings(history.meetings);
        } else {
          setMeetings([]);
        }
      } catch (err) {
        console.error("Error fetching history:", err);
        setError("Failed to load meeting history.");
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [getHistoryOfUser]);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    if (isNaN(date)) return "Invalid date";
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: "auto" }}>
      {/* Back to Home */}
      <IconButton
        onClick={() => navigate("/home")}
        sx={{ mb: 2 }}
        color="primary"
      >
        <HomeIcon />
      </IconButton>

      <Typography
        variant="h5"
        sx={{ mb: 3, fontWeight: 600, textAlign: "center" }}
      >
        Meeting History
      </Typography>

      {/* Loading */}
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Error */}
      {error && (
        <Typography color="error" sx={{ textAlign: "center", mt: 3 }}>
          {error}
        </Typography>
      )}

      {/* No meetings */}
      {!loading && !error && Array.isArray(meetings) && meetings.length === 0 && (
        <Typography sx={{ textAlign: "center", mt: 3 }}>
          No meeting history found.
        </Typography>
      )}

      {/* Meeting list */}
      {!loading &&
        !error &&
        Array.isArray(meetings) &&
        meetings.map((meeting, i) => (
          <Card
            key={i}
            variant="outlined"
            sx={{
              mb: 2,
              borderRadius: 2,
              boxShadow: 2,
              "&:hover": { boxShadow: 4 },
            }}
          >
            <CardActionArea>
              <CardContent>
                <Typography
                  sx={{ fontSize: 14 }}
                  color="text.secondary"
                  gutterBottom
                >
                  Meeting Code: {meeting.meetingCode || "N/A"}
                </Typography>

                <Typography sx={{ mb: 1.5 }} color="text.secondary">
                  Date: {meeting.date ? formatDate(meeting.date) : "Unknown"}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
    </Box>
  );
}
