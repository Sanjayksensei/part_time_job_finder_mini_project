// ------------------ LOGIN ------------------
function login() {
    // Auto-redirect to Job Seeker UI by default
    localStorage.setItem("role", "job_seeker");
    localStorage.setItem("currentView", "job_seeker");
    window.location.href = "dashboard.html";
}

// ------------------ DASHBOARD ROLE DISPLAY ------------------
function loadRole() {
    const role = localStorage.getItem("role");
    const display = document.getElementById("roleDisplay");

    if (display && role) {
        display.innerText = "Logged in as: " + role;
    }
}

// ------------------ LOGOUT ------------------
function logout() {
    localStorage.clear();
    window.location.href = "login.html";
}

// ------------------ APPLY JOB ------------------
function applyJob() {
    showToast("Application Submitted Successfully!");
}

// ------------------ SAVE PROFILE ------------------
function saveProfile() {
    showToast("Profile Updated Successfully!");
}

// ------------------ TOAST FUNCTION ------------------
function showToast(message) {
    alert(message);
}

// ------------------ AUTO LOAD FUNCTIONS ------------------
document.addEventListener("DOMContentLoaded", function() {
    loadRole();
});