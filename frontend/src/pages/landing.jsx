import React from "react";
import "../App.css";
import { Link, useNavigate } from "react-router-dom";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landingPageContainer">
      {/* Navbar */}
      <nav>
        <div className="navHeader">
          <h2>Quantum Meet</h2>
        </div>

        <div className="navlist">
          <p
            onClick={() => navigate("/guest")}
            className="navLink"
            role="button"
          >
            Join as Guest
          </p>
          <p
            onClick={() => navigate("/auth")}
            className="navLink"
            role="button"
          >
            Register
          </p>
          <div
            onClick={() => navigate("/auth")}
            className="navButton"
            role="button"
          >
            <p>Login</p>
          </div>
        </div>
      </nav>

      {/* Main Section */}
      <div className="landingMainContainer">
        <div className="landingText">
          <h1>
            <span style={{ color: "rgba(248, 7, 140, 1)" }}>Connect</span>{" "}
            Beyond Dimensions
          </h1>
          <p>
            Experience the next evolution of video conferencing with
            quantum-powered technology that transcends traditional boundaries.
          </p>
          <div role="button" className="getStartedBtn">
            <Link to="/auth">Get Started</Link>
          </div>
        </div>

        <div className="landingImage">
          <img src="/mobile.png" alt="Quantum meet app preview" />
        </div>
      </div>
    </div>
  );
}
