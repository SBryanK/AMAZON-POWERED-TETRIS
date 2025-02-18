# INTRODUCTION
Imagine a game that combines nostalgia with cutting-edge technology—welcome to Amazon-Powered Tetris. This isn’t just another Tetris game; just play, using nothing but your hands as controllers.
 
## Inspiration
Honestly, who doesn't love Tetris? It's one of those timeless games that brings nostalgia and excitement.  However, I wanted to take it to the next level by combining it with computer vision technology and AWS-powered deployment. The idea of controlling Tetris not with a keyboard but with hand gestures felt futuristic and fun. I just had a project on computer vision, took AWS certification, and like to play Tetris, a perfect combination of inspiration

## What it does
APT (Amazon Powered Tetris) allows you to play Tetris by moving your hands in front of your camera. The game detects your gestures to move, rotate, or drop the Tetris blocks. It also features a sleek, intuitive interface with live camera feedback, a leaderboard to track top scores, and there is a time limit to add a layer of challenge. So you can play Tetris and exercise at the same time, because you will need to stand up and move your entire body to play this game

## How we built it
For the frontend, I used React.js with Integrated MediaPipe (MediaipeJs) to detect hand gestures in real time with custom CSS and  a bit animations to create a visually appealing interface. Next, the backend was built with Python (Flask and Flask-SocketIO) to handle game logic and communication.
Designed the Tetris gameplay mechanics in Python, ensuring smooth animations and real-time updates.
Stored scores in a lightweight JSON-based structure for simplicity.
Taking it into next the step, for the deployment I choose to host the app using AWS ECS using AWS Fargate and security groups for scalability and reliability. With additional ability to manage static assets and WebSocket configurations to ensure seamless interaction between frontend and backend.

## Challenges we ran into
I never thought the logic behind Tetris will be quiet hefty. Translating traditional Tetris mechanics into Python while ensuring it synced perfectly with the hand gestures wasn't easy. The physics, collision detection, and scoring system had to be precise.

Getting the frontend and backend to communicate smoothly, especially over WebSockets, was tricky. Debugging latency and dropped connections took time. Next, Integrating MediaPipe Hands with React introduced a steep learning curve especially for me, first-time React user. Handling WASM-related errors and ensuring hand detection worked consistently across devices was a constant challenge and got me frustrated. 

And configuring ECS, handling port mappings, and ensuring the DNS setup worked for both the backend and frontend in production was far from straightforward. There was a lot of trial and error before we got it right.

## Accomplishments that we're proud of
I successfully implemented a system where players can control Tetris with just their hands. Finishing the Deployment of a fully functional app using AWS services was a big win for me, my first hands-on project of AWS. Nonetheless, the registration page, leaderboard, and gameplay interface came out better than I planned. Despite the numerous challenges, we persevered and built something we're genuinely proud of and I' really happy to get the experience of doing my first solo project for a full-stack web app

## What we learned
I gain a deeper understanding of React and Flask, as well as WebSockets (In how to handle real-time communication in web applications). Next, integrating MediaPipe Hands taught me deeper about computer vision and how to optimize it for browser-based applications. Every error and bug pushed me to think critically and creatively throughout the sleepless night. 

## What's next for APT (Amazon Powered Tetris)
I believe there are still a lot of room for big improvements. Some of my goal is to make it more robust as in the backend and the cv portion (faster and less error). Going further, I Imagine playing APT with friends, competing in real-time with gesture-based controls! It will be fun to expand APT to mobile devices for even broader accessibility. And enable players to customize the game interface and backgrounds for a more personalized experience.
