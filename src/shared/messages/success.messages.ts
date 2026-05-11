export const SuccessMessages = {
  AUTH: {
    VERIFICATION_OTP_SENT: 'Verification otp sent',
    EMAIL_VERIFIED: 'Email verified',
    VERIFICATION_EMAIL_RESENT: 'Verification email resent',
    LOGIN: 'Login successful',
    FORGOT_PASSWORD: 'If that email exists, a reset link has been sent',
    PASSWORD_UPDATED: 'Password updated. Please log in.',
    TOKEN_REFRESHED: 'Token refreshed successfully',
    LOGGED_OUT: 'Logged out',
  },
  INQUIRIES: {
    WAITLIST_JOINED: 'Added to waitlist',
    MESSAGE_RECEIVED: 'Message received',
  },
  ONBOARDING: {
    TALENT_COMPLETED: 'Talent onboarding completed',
    EMPLOYER_COMPLETED: 'Employer onboarding completed',
    CANDIDATE_COMPLETED: 'Candidate onboarding completed',
    GOAL_SAVED: 'Goal saved',
    TRACKS_SAVED: 'Role tracks saved',
    PROFILE_SAVED: 'Profile saved',
    AVATAR_UPLOADED: 'Avatar uploaded successfully',
  },
  COMMON: {
    SUCCESS: 'success',
    API_PROBE: 'I am the NestJs api responding',
  },
} as const;
