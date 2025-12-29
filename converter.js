#!/usr/bin/env node

const fs = require('fs');
const { program } = require('commander');
const { create } = require('xmlbuilder2');

// --- 1. THE PARSER ---
// Parses Mermaid xychart-beta syntax into a usable JSON object
function parseMermaid(content) {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    const chartData = {
        title: 'Untitled Chart',
        xAxis: [],
        yAxis: { label: '', min: 0, max: 100 },
        dataPoints: []
    };

    lines.forEach(line => {
        if (line.startsWith('title')) {
            chartData.title = line.replace('title', '').replace(/"/g, '').trim();
        } else if (line.startsWith('x-axis')) {
            // Extract content inside brackets [jan, feb, ...]
            const match = line.match(/\[(.*?)\]/);
            if (match) {
                chartData.xAxis = match[1].split(',').map(s => s.trim());
            }
        } else if (line.startsWith('y-axis')) {
            // parsing: y-axis "Label" 0 --> 100
            const parts = line.replace('y-axis', '').trim();
            const rangeMatch = parts.match(/(\d+)\s*-->\s*(\d+)/);
            if (rangeMatch) {
                chartData.yAxis.min = parseFloat(rangeMatch[1]);
                chartData.yAxis.max = parseFloat(rangeMatch[2]);
            }
            // title is harder to regex safely, simplified here:
            const titleMatch = parts.match(/"(.*?)"/);
            if(titleMatch) chartData.yAxis.label = titleMatch[1];
        } else if (line.startsWith('line')) {
            const match = line.match(/\[(.*?)\]/);
            if (match) {
                chartData.dataPoints = match[1].split(',').map(s => parseFloat(s.trim()));
            }
        }
    });

    return chartData;
}

// --- 2. THE MAPPER (Fixed Geometry) ---
// Converts abstract data into X,Y pixel coordinates
function calculateGeometry(chartData) {
    // Canvas settings
    const width = 600;
    const height = 400;
    const padding = 60;
    
    // NEW: Add specific offset so points don't sit on the axis lines
    const xOffset = 30; 

    const graphWidth = width - (padding * 2);
    const graphHeight = height - (padding * 2);

    // Calculate usable width (subtracting offsets from both sides)
    const usableWidth = graphWidth - (xOffset * 2);

    // Calculate Scales
    const yRange = chartData.yAxis.max - chartData.yAxis.min;
    
    // Safety check to prevent divide by zero if only 1 point
    const xStep = chartData.xAxis.length > 1 ? usableWidth / (chartData.xAxis.length - 1) : usableWidth;

    const points = chartData.dataPoints.map((val, index) => {
        // FIXED: Start at padding + xOffset
        const x = padding + xOffset + (index * xStep);
        
        // Invert Y because SVG/Drawio 0 is at the top
        const normalizedY = (val - chartData.yAxis.min) / yRange; 
        const y = (height - padding) - (normalizedY * graphHeight);
        return { x, y };
    });

    return { points, width, height, padding };
}

// --- 3. THE XML BUILDER (Fixed Styling) ---
// Generates Draw.io compatible XML with Axes, Grid, and Labels
function generateDrawioXML(chartData, geometry) {
    const root = create({ version: '1.0', encoding: 'UTF-8' })
        .ele('mxfile', { host: 'Electron', modified: new Date().toISOString(), agent: 'MermaidCLI', type: 'device' })
        .ele('diagram', { id: 'diagram-1', name: 'Page-1' })
        .ele('mxGraphModel', { dx: '0', dy: '0', grid: '1', gridSize: '10', guides: '1', tooltips: '1', connect: '1', arrows: '1', fold: '1', page: '1', pageScale: '1', pageWidth: '850', pageHeight: '1100', math: '0', shadow: '0' })
        .ele('root');

    // Default Parents
    root.ele('mxCell', { id: '0' });
    root.ele('mxCell', { id: '1', parent: '0' });

    // 3a. Draw Axes Lines
    // Vertical Axis Line
    root.ele('mxCell', { 
        id: 'axis-y', value: '', 
        style: 'endArrow=classic;html=1;rounded=0;strokeWidth=2;startSize=8;endSize=8;', 
        parent: '1', edge: '1' 
    }).ele('mxGeometry', { relative: '1', as: 'geometry' })
        .ele('mxPoint', { x: geometry.padding, y: geometry.height - geometry.padding, as: 'sourcePoint' }).up()
        .ele('mxPoint', { x: geometry.padding, y: geometry.padding, as: 'targetPoint' });

    // Horizontal Axis Line
    root.ele('mxCell', { 
        id: 'axis-x', value: '', 
        style: 'endArrow=classic;html=1;rounded=0;strokeWidth=2;startSize=8;endSize=8;', 
        parent: '1', edge: '1' 
    }).ele('mxGeometry', { relative: '1', as: 'geometry' })
        .ele('mxPoint', { x: geometry.padding, y: geometry.height - geometry.padding, as: 'sourcePoint' }).up()
        .ele('mxPoint', { x: geometry.width - geometry.padding, y: geometry.height - geometry.padding, as: 'targetPoint' });

    // 3b. Add Axis Labels
    // X-Axis Labels (Jan, Feb...)
    chartData.xAxis.forEach((label, i) => {
        if (i < geometry.points.length) {
            const p = geometry.points[i];
            root.ele('mxCell', {
                id: `xlabel-${i}`,
                value: label,
                style: 'text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=top;whiteSpace=wrap;rounded=0;',
                vertex: '1', parent: '1'
            }).ele('mxGeometry', { 
                x: p.x - 20, // Center the text roughly 
                y: geometry.height - geometry.padding + 5, // Just below the axis
                width: '40', height: '20', as: 'geometry' 
            });
        }
    });

    // Y-Axis Ticks (Simple 5-step scale)
    const steps = 5;
    const yRange = chartData.yAxis.max - chartData.yAxis.min;
    for(let i=0; i<=steps; i++) {
        const value = Math.round(chartData.yAxis.min + (yRange * (i/steps)));
        // Calculate Y pixel position
        const normalizedY = (value - chartData.yAxis.min) / yRange; 
        const yPos = (geometry.height - geometry.padding) - (normalizedY * (geometry.height - (geometry.padding*2)));
        
        root.ele('mxCell', {
            id: `ylabel-${i}`,
            value: value.toString(),
            style: 'text;html=1;strokeColor=none;fillColor=none;align=right;verticalAlign=middle;whiteSpace=wrap;rounded=0;',
            vertex: '1', parent: '1'
        }).ele('mxGeometry', { 
            x: geometry.padding - 45, // To the left of axis
            y: yPos - 10, 
            width: '40', height: '20', as: 'geometry' 
        });
        
        // Add faint grid line (skip 0 line so we don't draw over X axis)
        if(i > 0) { 
             root.ele('mxCell', { 
                id: `grid-${i}`, value: '', 
                style: 'endArrow=none;html=1;rounded=0;strokeColor=#E0E0E0;dashed=1;', 
                parent: '1', edge: '1' 
            }).ele('mxGeometry', { relative: '1', as: 'geometry' })
                .ele('mxPoint', { x: geometry.padding, y: yPos, as: 'sourcePoint' }).up()
                .ele('mxPoint', { x: geometry.width - geometry.padding, y: yPos, as: 'targetPoint' });
        }
    }

    // 3c. Draw Lines & Points
    for (let i = 0; i < geometry.points.length; i++) {
        const p1 = geometry.points[i];
        
        // Draw Line to next point
        if (i < geometry.points.length - 1) {
            const p2 = geometry.points[i+1];
            root.ele('mxCell', { 
                id: `line-${i}`, value: '', 
                style: 'endArrow=none;html=1;rounded=0;strokeWidth=2;strokeColor=#0066CC;', // Nicer Blue
                parent: '1', edge: '1' 
            }).ele('mxGeometry', { relative: '1', as: 'geometry' })
                .ele('mxPoint', { x: p1.x, y: p1.y, as: 'sourcePoint' }).up()
                .ele('mxPoint', { x: p2.x, y: p2.y, as: 'targetPoint' });
        }

        // Draw Data Point
        // FIXED: Added labelBackgroundColor=#ffffff so the number has a white background
        root.ele('mxCell', {
            id: `point-${i}`,
            value: chartData.dataPoints[i],
            style: 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#FF0000;strokeColor=none;verticalLabelPosition=top;verticalAlign=bottom;fontSize=11;fontStyle=1;labelBackgroundColor=#ffffff;',
            vertex: '1', parent: '1'
        }).ele('mxGeometry', { x: p1.x - 4, y: p1.y - 4, width: '8', height: '8', as: 'geometry' });
    }

    // 3d. Title
    root.ele('mxCell', {
        id: 'title',
        value: chartData.title,
        style: 'text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=18;fontStyle=1',
        vertex: '1', parent: '1'
    }).ele('mxGeometry', { x: geometry.padding, y: 10, width: geometry.width - (geometry.padding*2), height: '30', as: 'geometry' });

    return root.end({ prettyPrint: true });
}

// --- 4. CLI COMMANDS ---
program
    .name('mermaid2drawio')
    .description('CLI to convert Mermaid line charts to Draw.io XML')
    .version('1.0.0')
    .argument('<input>', 'path to input mermaid file')
    .argument('<output>', 'path to output xml file')
    .action((input, output) => {
        try {
            if (!fs.existsSync(input)) {
                console.error(`Error: File '${input}' not found.`);
                process.exit(1);
            }
            
            const content = fs.readFileSync(input, 'utf-8');
            console.log(`Reading ${input}...`);
            
            const data = parseMermaid(content);
            console.log(`Parsed chart: "${data.title}" with ${data.dataPoints.length} points.`);
            
            const geometry = calculateGeometry(data);
            const xml = generateDrawioXML(data, geometry);
            
            fs.writeFileSync(output, xml);
            console.log(`Successfully created ${output}!`);
            console.log(`You can now open this file in https://app.diagrams.net/`);
        } catch (error) {
            console.error("Error:", error.message);
        }
    });

program.parse();