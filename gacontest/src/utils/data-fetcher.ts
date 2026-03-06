import pako from 'pako';
import type { MatchData } from '../types';

// Use the absolute URL for the data source
export const DATA_URL = 'https://flowbot44.github.io/grand-arena-builder-skill/data';

export const fetchLatest = async () => {
  const response = await fetch(`${DATA_URL}/latest.json`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const data = await response.json();
  return data;
};

// Function to fetch and decompress a partition's data
export const fetchPartition = async (partitionUrl: string): Promise<MatchData[]> => {
  const response = await fetch(`${DATA_URL}/${partitionUrl}`);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  
  // Get data as an array buffer for pako to decompress
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Decompress the data
  const decompressed = pako.ungzip(uint8Array, { to: 'string' });
  
  // Parse the JSON
  const data = JSON.parse(decompressed);
  return data;
};
