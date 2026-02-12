# VeriLens

VeriLens is a decentralized protocol and web application designed to combat deepfakes using AI forensics and blockchain anchoring. It allows users to scan media (images/videos) to detect AI-generated content and enables creators to certify their original work on-chain.

## Features

- **Deepfake Detection Scanner:** Upload media to analyze authenticity using state-of-the-art AI models (via Hugging Face API).
- **Blockchain Certification:** (Planned) Anchor original content to the blockchain to prove ownership and authenticity.
- **Visual Evidence:** Provides detailed confidence scores and probability breakdowns for "Human" vs "Artificial" content.

## Project Structure

```
user_side/verilens/
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main landing page
│   │   └── api/scan/         # Next.js API route for handling scan requests
│   ├── components/
│   │   ├── Scanner.tsx       # Core scanning component with drag-and-drop
│   │   └── Navbar.tsx        # Navigation bar
│   └── lib/                  # Utility functions
├── public/                   # Static assets
└── package.json              # Project dependencies and scripts
```

## Setup & Installation

1.  **Prerequisites:**
    -   Node.js (v18+)
    -   npm or yarn

2.  **Install Dependencies:**
    ```bash
    cd user_side/verilens
    npm install
    ```

3.  **Environment Variables:**
    Create a `.env.local` file in the root of `user_side/verilens` and add your `HF_API_TOKEN`:
    ```env
    HF_API_TOKEN=your_hugging_face_token_here
    ```

    **Obtaining a Hugging Face API Token:**
    1. Create an account at [huggingface.co](https://huggingface.co).
    2. Go to **Settings → Access Tokens** ([direct link](https://huggingface.co/settings/tokens)).
    3. Create a new token with only the scopes you need (e.g., *read* access to Inference API).

    **Security guidance:**
    - **Never commit `.env.local` to version control.** Ensure `.env.local` is listed in your `.gitignore` (the default Next.js `.gitignore` already includes `.env*`).
    - For production deployments, use a secrets manager (e.g., Vercel Environment Variables, AWS Secrets Manager, or Doppler) instead of a local file.
    - Restrict your `HF_API_TOKEN` scopes to the minimum required permissions.
    - Rotate your tokens regularly and revoke any that may have been exposed.

4.  **Run Development Server:**
    ```bash
    npm run dev
    ```
    Open [http://localhost:3000](http://localhost:3000) to view the application.

## Contribution

-   **Testing:** Run `npm run lint` to check for code quality issues.
-   **Architecture:** The project uses Next.js App Router, Tailwind CSS for styling, and Shadcn UI for components.