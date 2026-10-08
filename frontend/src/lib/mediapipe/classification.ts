/** What a classifier call returns: the name it settled on, how firmly, and why. */
export interface MudraScore {
  name: string;
  /** 0-1. */
  confidence: number;
  feedback: string;
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export function calculateDistance(p1: Point, p2: Point): number {
  return Math.sqrt(
    Math.pow(p1.x - p2.x, 2) + 
    Math.pow(p1.y - p2.y, 2) + 
    Math.pow(p1.z - p2.z, 2)
  );
}

/**
 * Calculates how much a finger is extended.
 * Returns a value from 0 (fully bent) to 1 (fully straight).
 */
export function getFingerExtensionScore(landmarks: Point[], fingerIndices: number[]): number {
  const [mcpIdx, pipIdx, dipIdx, tipIdx] = fingerIndices;
  const mcp = landmarks[mcpIdx];
  const pip = landmarks[pipIdx];
  const dip = landmarks[dipIdx];
  const tip = landmarks[tipIdx];

  const distMcpTip = calculateDistance(mcp, tip);
  const distSegments = 
    calculateDistance(mcp, pip) + 
    calculateDistance(pip, dip) + 
    calculateDistance(dip, tip);

  return Math.min(1.0, distMcpTip / distSegments);
}

// `handedness` is accepted so both call sites can pass what MediaPipe gave
// them, but the rules are all relative to the hand's own geometry and so
// read the same on either hand.
export function classifyMudra(landmarks: Point[], handedness?: string) {
  const thumbIdx = [1, 2, 3, 4];
  const indexIdx = [5, 6, 7, 8];
  const middleIdx = [9, 10, 11, 12];
  const ringIdx = [13, 14, 15, 16];
  const pinkyIdx = [17, 18, 19, 20];

  const sThumb = getFingerExtensionScore(landmarks, thumbIdx);
  const sIdx = getFingerExtensionScore(landmarks, indexIdx);
  const sMid = getFingerExtensionScore(landmarks, middleIdx);
  const sRng = getFingerExtensionScore(landmarks, ringIdx);
  const sPky = getFingerExtensionScore(landmarks, pinkyIdx);

  const thumbTip = landmarks[4];
  const ringTip = landmarks[16];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const pinkyTip = landmarks[20];

  const distThumbRing = calculateDistance(thumbTip, ringTip);
  const distIdxMid = calculateDistance(indexTip, middleTip);
  const distMidRng = calculateDistance(middleTip, ringTip);
  const distThumbIndex = calculateDistance(thumbTip, indexTip);
  const distMidThumb = calculateDistance(middleTip, thumbTip);
  const distRngThumb = calculateDistance(ringTip, thumbTip);
  const distPkyThumb = calculateDistance(pinkyTip, thumbTip);

  const isExt = (s: number) => s > 0.85;
  const isCurved = (s: number) => s > 0.4 && s < 0.85;
  const isBent = (s: number) => s < 0.65;

  let bestMudra = null;
  let maxConfidence = 0;

  // 1. Pataka: All 4 straight & together, thumb close to palm
  if (isExt(sIdx) && isExt(sMid) && isExt(sRng) && isExt(sPky)) {
    if (distThumbIndex < 0.12) { // Prevents classifying as Ardhachandra
      const togetherness = 1 - (distIdxMid + distMidRng) * 2;
      const confidence = (sIdx + sMid + sRng + sPky) / 4 * Math.max(0, togetherness);
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Pataka", confidence, feedback: "Excellent. Keep the fingers strictly together." };
      }
    }
  }

  // 2. Tripataka: Pataka + Ring bent
  if (isExt(sIdx) && isExt(sMid) && isBent(sRng) && isExt(sPky)) {
    const confidence = (sIdx + sMid + (1 - sRng) + sPky) / 4;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Tripataka", confidence, feedback: "Good. Ring finger must be distinctly bent." };
    }
  }

  // 3. Ardhapataka: Index, Middle straight, others bent
  if (isExt(sIdx) && isExt(sMid) && isBent(sRng) && isBent(sPky)) {
    const confidence = (sIdx + sMid + (1 - sRng) + (1 - sPky)) / 4;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Ardhapataka", confidence, feedback: "Keep index and middle fingers vertical." };
    }
  }

  // 4. Kartarimukha: Index, Middle spread V
  if (isExt(sIdx) && isExt(sMid) && isBent(sRng) && isBent(sPky) && distIdxMid > 0.08) {
    const confidence = (sIdx + sMid + (1 - sRng) + (1 - sPky)) / 4;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Kartarimukha", confidence, feedback: "Great V-shape. Keep fingers fully extended." };
    }
  }

  // 5. Mayura: Ring touching Thumb
  if (distThumbRing < 0.05 && isExt(sIdx) && isExt(sMid) && isExt(sPky)) {
    const confidence = (1 - distThumbRing * 10) * ((sIdx + sMid + sPky) / 3);
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Mayura", confidence, feedback: "Peacock pose. Spread other fingers slightly." };
    }
  }

  // 6. Arala: Index bent
  if (isBent(sIdx) && isExt(sMid) && isExt(sRng) && isExt(sPky)) {
    const confidence = ((1 - sIdx) + sMid + sRng + sPky) / 4;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Arala", confidence, feedback: "Ensure the other three fingers are straight." };
    }
  }

  // 7. Shukatunda: Index/Ring bent
  if (isBent(sIdx) && isExt(sMid) && isBent(sRng) && isExt(sPky)) {
    const confidence = ((1 - sIdx) + sMid + (1 - sRng) + sPky) / 4;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Shukatunda", confidence, feedback: "Hook the index finger clearly." };
    }
  }

  // 9. Mushti: Closed fist
  if (isBent(sIdx) && isBent(sMid) && isBent(sRng) && isBent(sPky) && !isExt(sThumb)) {
    // Make sure fingers are curled tightly (score very low)
    if (sIdx < 0.5 && sMid < 0.5) {
      const confidence = ((1 - sIdx) + (1 - sMid) + (1 - sRng) + (1 - sPky) + (1 - sThumb)) / 5;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Mushti", confidence, feedback: "Keep the fist tight." };
      }
    }
  }

  // 10. Shikhara: Mushti + Thumb up
  if (isBent(sIdx) && isBent(sMid) && isBent(sRng) && isBent(sPky) && isExt(sThumb)) {
    if (sIdx < 0.5 && sMid < 0.5) {
      const confidence = ((1 - sIdx) + (1 - sMid) + (1 - sRng) + (1 - sPky) + sThumb) / 5;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Shikhara", confidence, feedback: "Great. Keep the thumb pointing straight up." };
      }
    }
  }

  // 11. Suchi: Index straight, others bent
  if (isExt(sIdx) && isBent(sMid) && isBent(sRng) && isBent(sPky) && !isExt(sThumb)) {
    const confidence = (sIdx + (1 - sMid) + (1 - sRng) + (1 - sPky) + (1 - sThumb)) / 5;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Suchi", confidence, feedback: "Keep the index finger perfectly straight." };
    }
  }

  // 12. Chandrakala: Suchi + Thumb extended
  if (isExt(sIdx) && isBent(sMid) && isBent(sRng) && isBent(sPky) && isExt(sThumb)) {
    const confidence = (sIdx + (1 - sMid) + (1 - sRng) + (1 - sPky) + sThumb) / 5;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Chandrakala", confidence, feedback: "Make a nice crescent moon shape." };
    }
  }

  // 13. Padmakosha: All fingers slightly bent (cup shape)
  if (isCurved(sIdx) && isCurved(sMid) && isCurved(sRng) && isCurved(sPky)) {
    // They should be spread a bit, not touching
    if (distIdxMid > 0.03 && distMidRng > 0.03) {
      // Confidence peaks around 0.6 extension
      const curveScore = (s: number) => 1 - Math.abs(s - 0.6) * 2;
      const confidence = (curveScore(sIdx) + curveScore(sMid) + curveScore(sRng) + curveScore(sPky)) / 4;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Padmakosha", confidence, feedback: "Curve hands like holding a small ball." };
      }
    }
  }

  
  // 14. Ardhachandra: Pataka + Thumb extended outwards
  if (isExt(sIdx) && isExt(sMid) && isExt(sRng) && isExt(sPky) && isExt(sThumb)) {
    if (distThumbIndex > 0.1) {
      const confidence = (sIdx + sMid + sRng + sPky + sThumb) / 5;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Ardhachandra", confidence, feedback: "Keep thumb stretched completely outward." };
      }
    }
  }

  // 15. Sarpashirsha: Pataka but hollowed palm
  if (isCurved(sIdx) && isCurved(sMid) && isCurved(sRng) && isCurved(sPky)) {
    if (distIdxMid < 0.03 && distMidRng < 0.03) {
      const confidence = (sIdx + sMid + sRng + sPky) / 4;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Sarpashirsha", confidence, feedback: "Curve your palm to make a snake hood." };
      }
    }
  }

  // 16. Simhamukha: Index & Pinky extended, middle & ring touching thumb
  if (isExt(sIdx) && isExt(sPky) && isBent(sMid) && isBent(sRng)) {
    if (distMidThumb < 0.05 && distRngThumb < 0.05) {
      const confidence = (sIdx + sPky + (1 - sMid) + (1 - sRng)) / 4;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Simhamukha", confidence, feedback: "Excellent lion face. Keep outer fingers straight." };
      }
    }
  }

  // 17. Mukula: All 5 fingertips touching
  if (distThumbIndex < 0.05 && distMidThumb < 0.05 && distRngThumb < 0.05 && distPkyThumb < 0.05) {
    const confidence = 1 - (distThumbIndex + distMidThumb + distRngThumb + distPkyThumb) * 2;
    if (confidence > maxConfidence && confidence > 0.4) {
      maxConfidence = confidence;
      bestMudra = { name: "Mukula", confidence, feedback: "Bring all fingertips to a tight point." };
    }
  }

  // 18. Trishula: Index, Middle, Ring extended. Pinky and Thumb bent.
  if (isExt(sIdx) && isExt(sMid) && isExt(sRng) && isBent(sPky) && isBent(sThumb)) {
    const confidence = (sIdx + sMid + sRng + (1 - sPky) + (1 - sThumb)) / 5;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Trishula", confidence, feedback: "Good trident shape." };
    }
  }

  // 8. Alapadma: All spread & curved
  if (isBent(sIdx) && isBent(sMid) && isBent(sRng) && isBent(sPky)) {
    if (distIdxMid > 0.04 && distMidRng > 0.04) {
      const confidence = ((1 - sIdx) + (1 - sMid) + (1 - sRng) + (1 - sPky)) / 4;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Alapadma", confidence, feedback: "Beautiful lotus. Rotate the palm outward." };
      }
    }
  }

  if (maxConfidence > 0.5 && bestMudra) {
    // Calibrate confidence curve: keep clean 0..1 bounded precision
    bestMudra.confidence = Math.min(1.0, Math.round(bestMudra.confidence * 100) / 100);
    return bestMudra;
  }

  return { name: "No Mudra Detected", confidence: Math.round((maxConfidence || 0) * 100) / 100, feedback: "Adjust your hand position or check the lighting." };
}

/** 
 * Returns the confidence score for a specific mudra regardless of whether it is the 'best' match.
 * Useful for Practice Mode where we want to see progress towards a specific goal.
 */
export function getSpecificMudraScore(landmarks: Point[], targetMudra: string, handedness: string): MudraScore {
  const result = _getSpecificMudraScoreRaw(landmarks, targetMudra, handedness);
  if (result && result.confidence) {
    result.confidence = Math.min(1.0, Math.round(result.confidence * 100) / 100);
  }
  return result;
}

function _getSpecificMudraScoreRaw(landmarks: Point[], targetMudra: string, handedness?: string): MudraScore {
  const thumbIdx = [1, 2, 3, 4];
  const indexIdx = [5, 6, 7, 8];
  const middleIdx = [9, 10, 11, 12];
  const ringIdx = [13, 14, 15, 16];
  const pinkyIdx = [17, 18, 19, 20];

  const sThumb = getFingerExtensionScore(landmarks, thumbIdx);
  const sIdx = getFingerExtensionScore(landmarks, indexIdx);
  const sMid = getFingerExtensionScore(landmarks, middleIdx);
  const sRng = getFingerExtensionScore(landmarks, ringIdx);
  const sPky = getFingerExtensionScore(landmarks, pinkyIdx);

  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const distThumbRing = calculateDistance(thumbTip, ringTip);
  const distIdxMid = calculateDistance(indexTip, middleTip);
  const distMidRng = calculateDistance(middleTip, ringTip);
  const distThumbIndex = calculateDistance(thumbTip, indexTip);
  const distMidThumb = calculateDistance(middleTip, thumbTip);
  const distRngThumb = calculateDistance(ringTip, thumbTip);
  const distPkyThumb = calculateDistance(pinkyTip, thumbTip);

  const isExt = (s: number) => s > 0.85;
  const isBent = (s: number) => s < 0.65;

  switch (targetMudra.toLowerCase()) {
    case 'pataka': {
      const togetherScore = 1 - (distIdxMid + distMidRng) * 1.5;
      let feedback = "Excellent Pataka form.";
      if (togetherScore < 0.7) feedback = "Bring all fingers closer together.";
      else if (!isExt(sIdx)) feedback = "Straighten your Index finger.";
      else if (!isExt(sMid)) feedback = "Straighten your Middle finger.";
      else if (!isExt(sRng)) feedback = "Straighten your Ring finger.";
      else if (!isExt(sPky)) feedback = "Straighten your Pinky finger.";
      else if (distThumbIndex > 0.12) feedback = "Keep your thumb close to your palm (don't stretch it out).";
      
      return { 
        name: "Pataka", 
        confidence: ((sIdx + sMid + sRng + sPky) / 4) * Math.max(0.1, togetherScore) * (distThumbIndex < 0.12 ? 1 : 0.6),
        feedback 
      };
    }
    
    case 'tripataka': {
      let feedback = "Good Tripataka form.";
      if (!isExt(sIdx)) feedback = "Keep Index finger straight.";
      else if (!isExt(sMid)) feedback = "Keep Middle finger straight.";
      else if (!isBent(sRng)) feedback = "Bend your Ring finger more.";
      else if (!isExt(sPky)) feedback = "Keep Pinky finger straight.";
      
      return { 
        name: "Tripataka", 
        confidence: (sIdx + sMid + (1 - sRng) + sPky) / 4,
        feedback 
      };
    }

    case 'ardhapataka': {
      let feedback = "Great Ardhapataka.";
      if (!isExt(sIdx)) feedback = "Straighten your Index finger.";
      else if (!isExt(sMid)) feedback = "Straighten your Middle finger.";
      else if (sRng > 0.5) feedback = "Bend your Ring finger fully.";
      else if (sPky > 0.5) feedback = "Bend your Pinky finger fully.";
      
      return { 
        name: "Ardhapataka", 
        confidence: (sIdx + sMid + (1 - sRng) + (1 - sPky)) / 4,
        feedback 
      };
    }

    case 'kartarimukha': {
      let feedback = "Perfect Kartarimukha v-shape.";
      if (distIdxMid < 0.08) feedback = "Spread Index and Middle fingers wider.";
      else if (!isExt(sIdx)) feedback = "Straighten your Index finger.";
      else if (!isExt(sMid)) feedback = "Straighten your Middle finger.";
      else if (sRng > 0.5) feedback = "Ring finger should be bent.";
      
      return { 
        name: "Kartarimukha", 
        confidence: ((sIdx + sMid + (1 - sRng) + (1 - sPky)) / 4) * (distIdxMid > 0.08 ? 1 : 0.6),
        feedback 
      };
    }

    case 'mayura': {
      let feedback = "Beautiful Peacock pose.";
      if (distThumbRing > 0.06) feedback = "Touch Thumb tip to Ring finger tip.";
      else if (!isExt(sIdx)) feedback = "Index finger must be straight.";
      else if (!isExt(sMid)) feedback = "Middle finger must be straight.";
      else if (!isExt(sPky)) feedback = "Pinky finger must be straight.";
      
      return { 
        name: "Mayura", 
        confidence: (1 - distThumbRing * 10) * ((sIdx + sMid + sPky) / 3),
        feedback 
      };
    }

    case 'arala': {
      let feedback = "Arala mudra detected.";
      if (sIdx > 0.6) feedback = "Bend your Index finger into a hook.";
      else if (!isExt(sMid)) feedback = "Middle finger should be vertical.";
      else if (!isExt(sRng)) feedback = "Ring finger should be vertical.";
      else if (!isExt(sPky)) feedback = "Pinky finger should be vertical.";
      
      return { 
        name: "Arala", 
        confidence: ((1 - sIdx) + sMid + sRng + sPky) / 4,
        feedback 
      };
    }

    case 'shukatunda': {
      let feedback = "Excellent Shukatunda.";
      if (sIdx > 0.6) feedback = "Index finger should be hooked.";
      else if (sRng > 0.6) feedback = "Ring finger should be hooked.";
      else if (!isExt(sMid)) feedback = "Middle finger must be straight.";
      else if (!isExt(sPky)) feedback = "Pinky must be straight.";
      
      return { 
        name: "Shukatunda", 
        confidence: ((1 - sIdx) + sMid + (1 - sRng) + sPky) / 4,
        feedback 
      };
    }

    case 'alapadma': {
      let feedback = "Beautiful Alapadma lotus.";
      const isSpread = distIdxMid > 0.04 && distMidRng > 0.04;
      if (!isSpread) feedback = "Spread all fingers outward.";
      else if (sIdx > 0.6) feedback = "Curve your Index finger back.";
      else if (sMid > 0.6) feedback = "Curve your Middle finger back.";
      
      return { 
        name: "Alapadma", 
        confidence: ((1 - sIdx) + (1 - sMid) + (1 - sRng) + (1 - sPky)) / 4,
        feedback 
      };
    }

    case 'mushti': {
      let feedback = "Good closed fist.";
      if (!isBent(sIdx)) feedback = "Curl your Index finger tightly.";
      else if (!isBent(sMid)) feedback = "Curl your Middle finger tightly.";
      else if (isExt(sThumb)) feedback = "Rest thumb over your fingers.";
      
      return {
        name: "Mushti",
        confidence: ((1 - sIdx) + (1 - sMid) + (1 - sRng) + (1 - sPky) + (1 - sThumb)) / 5,
        feedback
      };
    }

    case 'shikhara': {
      let feedback = "Perfect Shikhara peak.";
      if (!isExt(sThumb)) feedback = "Extend thumb straight up.";
      else if (!isBent(sIdx)) feedback = "Keep other fingers curled in a fist.";
      
      return {
        name: "Shikhara",
        confidence: ((1 - sIdx) + (1 - sMid) + (1 - sRng) + (1 - sPky) + sThumb) / 5,
        feedback
      };
    }

    case 'suchi': {
      let feedback = "Good Suchi needle.";
      if (!isExt(sIdx)) feedback = "Extend Index finger completely straight.";
      else if (!isBent(sMid) || !isBent(sRng)) feedback = "Keep other fingers curled.";
      else if (isExt(sThumb)) feedback = "Tuck your thumb in.";
      
      return {
        name: "Suchi",
        confidence: (sIdx + (1 - sMid) + (1 - sRng) + (1 - sPky) + (1 - sThumb)) / 5,
        feedback
      };
    }

    case 'chandrakala': {
      let feedback = "Great crescent moon.";
      if (!isExt(sIdx)) feedback = "Extend Index finger.";
      else if (!isExt(sThumb)) feedback = "Extend Thumb outward.";
      else if (!isBent(sMid)) feedback = "Keep remaining fingers curled.";
      
      return {
        name: "Chandrakala",
        confidence: (sIdx + (1 - sMid) + (1 - sRng) + (1 - sPky) + sThumb) / 5,
        feedback
      };
    }

    case 'padmakosha': {
      let feedback = "Nice lotus bud.";
      if (sIdx > 0.85) feedback = "Curve your fingers more.";
      else if (sIdx < 0.4) feedback = "Don't curl fingers too tightly.";
      else if (distIdxMid < 0.02) feedback = "Spread fingers slightly apart.";
      
      const curveScore = (s: number) => 1 - Math.abs(s - 0.6) * 2;
      return {
        name: "Padmakosha",
        confidence: Math.max(0, (curveScore(sIdx) + curveScore(sMid) + curveScore(sRng) + curveScore(sPky)) / 4),
        feedback
      };
    }

    
    case 'ardhachandra': {
      let feedback = "Nice half moon.";
      if (!isExt(sThumb)) feedback = "Stretch thumb completely away from index.";
      return { name: "Ardhachandra", confidence: (sIdx + sMid + sRng + sPky + sThumb) / 5, feedback };
    }
    case 'sarpashirsha': {
      const feedback = "Good snake hood.";
      return { name: "Sarpashirsha", confidence: (sIdx + sMid + sRng + sPky) / 4, feedback };
    }
    case 'simhamukha': {
      let feedback = "Great lion face.";
      if (!isExt(sIdx) || !isExt(sPky)) feedback = "Keep index and pinky straight.";
      return { name: "Simhamukha", confidence: (sIdx + sPky + (1 - sMid) + (1 - sRng)) / 4, feedback };
    }
    case 'mukula': {
      const feedback = "Good bud shape.";
      const confidence = 1 - (distThumbIndex + distMidThumb + distRngThumb + distPkyThumb) * 2;
      return { name: "Mukula", confidence: Math.max(0, confidence), feedback };
    }
    case 'trishula': {
      let feedback = "Nice trident.";
      if (!isExt(sRng)) feedback = "Straighten ring finger.";
      return { name: "Trishula", confidence: (sIdx + sMid + sRng + (1 - sPky) + (1 - sThumb)) / 5, feedback };
    }

    default:
      return { name: targetMudra, confidence: 0, feedback: "Keep practicing the form." };
  }
}


export function classifySamyuktaMudra(hand1: Point[], hand2: Point[]) {
  const h1 = classifyMudra(hand1, "Left");
  const h2 = classifyMudra(hand2, "Right");
  
  if (!h1 || !h2 || h1.name === "No Mudra Detected" || h2.name === "No Mudra Detected") return null;

  const distWrists = calculateDistance(hand1[0], hand2[0]);
  const distMiddleTips = calculateDistance(hand1[12], hand2[12]);

  let bestMudra = null;
  let maxConfidence = 0;

  // 1. Anjali
  if (h1.name === "Pataka" && h2.name === "Pataka" && distWrists < 0.1 && distMiddleTips < 0.1) {
    const confidence = (h1.confidence + h2.confidence) / 2;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Anjali", confidence, feedback: "Beautiful prayer pose. Keep palms pressed." };
    }
  }

  // 2. Kapota
  if ((h1.name === "Pataka" || h1.name === "Padmakosha" || h1.name === "Sarpashirsha") && distWrists < 0.1 && distMiddleTips < 0.1) {
    const distPalms = calculateDistance(hand1[9], hand2[9]);
    if (distPalms > 0.05) {
      const confidence = (h1.confidence + h2.confidence) / 2;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Kapota", confidence, feedback: "Good pigeon pose. Keep palms hollow." };
      }
    }
  }

  // 3. Karkata
  if (distWrists < 0.1 && distMiddleTips > 0.05) {
    const confidence = 0.8;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Karkata", confidence, feedback: "Interlock fingers tightly." };
    }
  }

  // 4. Swastika
  if (distWrists < 0.05 && distMiddleTips > 0.1) {
    const confidence = (h1.confidence + h2.confidence) / 2;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Swastika", confidence, feedback: "Good crossed wrists." };
    }
  }

  // 5. Shivalinga
  if ((h1.name === "Pataka" && h2.name === "Shikhara") || (h2.name === "Pataka" && h1.name === "Shikhara")) {
    if (distWrists < 0.15) {
      const confidence = (h1.confidence + h2.confidence) / 2;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMudra = { name: "Shivalinga", confidence, feedback: "Excellent Shivalinga. Keep base flat." };
      }
    }
  }

  // 6. Pushpaputa
  if (h1.name === "Sarpashirsha" && h2.name === "Sarpashirsha" && distWrists < 0.1) {
    const confidence = (h1.confidence + h2.confidence) / 2;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Pushpaputa", confidence, feedback: "Join the sides of your hands to form a bowl." };
    }
  }

  // 7. Matsya
  if (h1.name === "Pataka" && h2.name === "Pataka" && distWrists < 0.08) {
    const confidence = (h1.confidence + h2.confidence) / 2;
    if (confidence > maxConfidence) {
      maxConfidence = confidence;
      bestMudra = { name: "Matsya", confidence, feedback: "Place palms exactly on top of each other." };
    }
  }
  
  // 8. Garuda
  if ((h1.name === "Ardhachandra" || h1.name === "Alapadma") && distWrists < 0.15) {
     const distThumbs = calculateDistance(hand1[4], hand2[4]);
     if (distThumbs < 0.05) {
       const confidence = (h1.confidence + h2.confidence) / 2;
       if (confidence > maxConfidence) {
         maxConfidence = confidence;
         bestMudra = { name: "Garuda", confidence, feedback: "Interlock thumbs and spread wings wide." };
       }
     }
  }

  if (maxConfidence > 0.5) {
    return bestMudra;
  }
  return null;
}
