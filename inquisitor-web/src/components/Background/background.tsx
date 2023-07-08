import { Delaunay, Voronoi } from 'd3-delaunay';
import { hsv } from 'd3-hsv';
import * as d3 from 'd3-color';
import { mat4 } from 'gl-matrix';
import { useEffect, useRef, useState } from 'react';
import { FunctionComponent } from 'react';

const vertexShaderSource = `
		attribute vec4 aVertexPosition;
		attribute vec4 aVertexColor;

		uniform mat4 uModelViewMatrix;
		uniform mat4 uProjectionMatrix;

		varying lowp vec4 vColor;

		void main() {
			gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
			vColor = aVertexColor;
		}
	`;

const fragmentShaderSource = `
		varying lowp vec4 vColor;

		void main() {
			gl_FragColor = vColor;
		}
	`;

const randomRange = (min: number, max: number): number => {
    return Math.random() * (max - min) + min;
};

const generatePoint = (x: number, y: number, jitter: number) =>
    new Point(
        new Vector2(
            x + randomRange(x - jitter / 2, x + jitter / 2),
            y + randomRange(y - jitter / 2, y + jitter / 2)
        ),
        RGB.randomDark()
    );

/**
 * const x = i; // todo randomize within the square
                    const y = j;
                    const color = RGB.randomDark();
                    const point = new Point(new Vector2(x, y), color);
                    this.fixedPoints.push(point);
 */

class GameBoard {
    fixedPoints: Point[] = [];
    context: WebGL2RenderingContext;
    voronoi: Voronoi<Float32Array>;
    xmax: number;
    ymax: number;
    delaunayInput: Float64Array;
    pointDensity: number;
    programInfo: {
        program: WebGLProgram;
        attribLocations: { vertexPosition: number; vertexColor: number };
        uniformLocations: { projectionMatrix: any; modelViewMatrix: any };
        buffers: { position: WebGLBuffer; color: WebGLBuffer };
    };

    constructor(
        context: WebGL2RenderingContext,
        width: number,
        height: number,
        pointDensity: number = 150 // pixels per point
    ) {
        this.context = context;
        this.xmax = width;
        this.ymax = height;
        this.pointDensity = pointDensity;

        console.log({
            clientWidth: (this.context.canvas as HTMLCanvasElement).clientWidth,
            clientHeight: (this.context.canvas as HTMLCanvasElement)
                .clientHeight,
            width,
            height,
        });

        // initialize canvas size
        context.viewport(0, 0, width, height);

        // initialize stationary points
        // todo may need to flip this upside down, since y = 0 is at the bottom of the screen? maybe flip the whole canvas?
        for (let i = 0; i < this.xmax; i += pointDensity) {
            for (let j = 0; j < this.ymax; j += pointDensity) {
                this.fixedPoints.push(generatePoint(i, j, pointDensity));
            }
        }

        // setup delaunay input vector
        this.delaunayInput = new Float64Array(2 * this.fixedPoints.length);
        this.fixedPoints.forEach((point, index) => {
            const offset = 2 * index;
            this.delaunayInput[offset] = point.location.x;
            this.delaunayInput[offset + 1] = point.location.y;
        });

        // initialize delaunay representation
        const delaunay = new Delaunay(this.delaunayInput);

        // generate the voronoi pattern, with the bounds set to the edges of the canvas
        this.voronoi = delaunay.voronoi([0, 0, width, height]);

        // initialize shaders
        const vertexShader = context.createShader(
            context.VERTEX_SHADER
        ) as WebGLShader;
        context.shaderSource(vertexShader, vertexShaderSource);
        context.compileShader(vertexShader);
        if (!context.getShaderParameter(vertexShader, context.COMPILE_STATUS)) {
            console.error('Failed to compile vertex shader');
            console.error(context.getShaderInfoLog(vertexShader));
        }
        const fragmentShader = context.createShader(
            context.FRAGMENT_SHADER
        ) as WebGLShader;
        context.shaderSource(fragmentShader, fragmentShaderSource);
        context.compileShader(fragmentShader);
        if (
            !context.getShaderParameter(fragmentShader, context.COMPILE_STATUS)
        ) {
            console.error('Failed to compile fragment shader');
            console.error(context.getShaderInfoLog(fragmentShader));
        }

        // create shader program
        const shaderProgram = context.createProgram() as WebGLProgram;
        context.attachShader(shaderProgram, vertexShader);
        context.attachShader(shaderProgram, fragmentShader);
        context.linkProgram(shaderProgram);
        if (!context.getProgramParameter(shaderProgram, context.LINK_STATUS)) {
            console.error('Unable to initialize shader program');
            console.error(context.getProgramInfoLog(shaderProgram));
        }

        const vertexPosition = context.getAttribLocation(
            shaderProgram,
            'aVertexPosition'
        );
        const vertexColor = context.getAttribLocation(
            shaderProgram,
            'aVertexColor'
        );
        this.programInfo = {
            program: shaderProgram,
            attribLocations: {
                vertexPosition,
                vertexColor,
            },
            uniformLocations: {
                projectionMatrix: context.getUniformLocation(
                    shaderProgram,
                    'uProjectionMatrix'
                ),
                modelViewMatrix: context.getUniformLocation(
                    shaderProgram,
                    'uModelViewMatrix'
                ),
            },
            buffers: this.initBuffers(vertexPosition, vertexColor),
        };

        // set clear colour to be black, and clear everything on clear()
        context.clearColor(0, 0, 0, 1);
        context.clearDepth(1);

        // enable depth testing and make near things obscur far things
        context.enable(context.DEPTH_TEST);
        context.depthFunc(context.LEQUAL);
        // define the projection bounds
        const projectionMatrix = mat4.create();
        mat4.ortho(projectionMatrix, -1, 1, -1, 1, -100, 100);

        // create a matrix to store the current drawing position - just keep the default
        const modelViewMatrix = mat4.create();
        // flip upside-down, so that y = 0 is at the top
        mat4.scale(modelViewMatrix, modelViewMatrix, [1, -1, 1]);

        // select drawing program
        context.useProgram(this.programInfo.program);

        // set shader uniforms (static each frame)
        context.uniformMatrix4fv(
            this.programInfo.uniformLocations.projectionMatrix,
            false,
            projectionMatrix
        );
        context.uniformMatrix4fv(
            this.programInfo.uniformLocations.modelViewMatrix,
            false,
            modelViewMatrix
        );

        // draw
        this.draw();
    }

    /**
     * Get the color of the point at the given index
     * @param index
     */
    getColor = (index: number): d3.RGBColor =>
        this.fixedPoints[index].color.rgb();

    /**
     * Scale a vertex from [0 0 xmax ymax] space to [-1 -1 1 1] space
     * @param vertex
     */
    scale(vertex: Delaunay.Point): [number, number] {
        const x = (vertex[0] * 2) / this.xmax - 1;
        const y = (vertex[1] * 2) / this.ymax - 1;
        return [x, y];
    }

    initBuffers(
        vertexPosition: number,
        vertexColor: number
    ): { position: WebGLBuffer; color: WebGLBuffer } {
        const context = this.context;

        // init vertex buffer
        const positionBuffer = context.createBuffer() as WebGLBuffer;
        context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
        context.bufferData(
            context.ARRAY_BUFFER,
            new Float32Array([]),
            context.STATIC_DRAW
        );

        // init color buffer
        const colorBuffer = context.createBuffer() as WebGLBuffer;
        context.bindBuffer(context.ARRAY_BUFFER, colorBuffer);
        context.bufferData(
            context.ARRAY_BUFFER,
            new Float32Array([]),
            context.STATIC_DRAW
        );

        // tell webgl how to pull positions from positionBuffer into the vertexPosition attribute
        {
            const numComponents = 2; // every iteration grab a vertex: xy
            const type = context.FLOAT; // datatype is 32-bit float
            const normalize = false;
            const stride = 0; // not sure what this is for
            const offset = 0;
            context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
            console.debug({ this: this });
            context.vertexAttribPointer(
                vertexPosition,
                numComponents,
                type,
                normalize,
                stride,
                offset
            );
            context.enableVertexAttribArray(vertexPosition);
        }

        // tell webgl how to pull colors from colorBuffer into the vertexColor attribute
        {
            const numComponents = 4; // rgba
            const type = context.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            context.bindBuffer(context.ARRAY_BUFFER, colorBuffer);
            context.vertexAttribPointer(
                vertexColor,
                numComponents,
                type,
                normalize,
                stride,
                offset
            );
            context.enableVertexAttribArray(vertexColor);
        }

        return { position: positionBuffer, color: colorBuffer };
    }

    refreshBuffers(voronoiCells: (Delaunay.Polygon & { index: number })[]) {
        const context = this.context;
        // vertices and their corresponding colors
        const vertices: number[] = []; // x y x y x y x y
        const colors: number[] = []; // r g b a r g b a r g b a r g b a
        voronoiCells.forEach((cell, index) => {
            const color = this.getColor(index).rgb();
            const r = color.r / 255;
            const g = color.g / 255;
            const b = color.b / 255;
            cell.forEach((vertex, index) => {
                if (index > 0) {
                    vertices.push(this.scale(vertex)[0]);
                    vertices.push(this.scale(vertex)[1]);
                    colors.push(r);
                    colors.push(g);
                    colors.push(b);
                    colors.push(1);
                }
            });
        });

        // fill vertex buffer
        context.bindBuffer(
            context.ARRAY_BUFFER,
            this.programInfo.buffers.position
        );
        context.bufferData(
            context.ARRAY_BUFFER,
            new Float32Array(vertices),
            context.STATIC_DRAW
        );

        // fill color buffer
        context.bindBuffer(
            context.ARRAY_BUFFER,
            this.programInfo.buffers.color
        );
        context.bufferData(
            context.ARRAY_BUFFER,
            new Float32Array(colors),
            context.STATIC_DRAW
        );
    }

    draw() {
        // render rovers and cells
        // update the voronoi diagram
        this.voronoi.update();
        const context = this.context;

        console.debug({
            voronoi: this.voronoi,
            delaunayInput: this.delaunayInput,
        });

        // refresh buffers
        const cellPolygons = Array.from(this.voronoi.cellPolygons());
        this.refreshBuffers(cellPolygons);

        // clear canvas

        // draw - since each polygon has a different number of vertices,
        // we need to iterate over them and make a separate draw call for each
        context.bindBuffer(
            context.ARRAY_BUFFER,
            this.programInfo.buffers.position
        );
        let offset = 0;
        cellPolygons.forEach((cell) => {
            const vertexCount = cell.length - 1; // first vertex is a duplicate of the last and is ignored
            context.drawArrays(context.TRIANGLE_FAN, offset, vertexCount);
            offset += vertexCount;
        });
    }

    resize(newWidth: number, newHeight: number) {
        // generate points to fill new space
        // bottom
        if (newWidth > this.xmax) {
            for (
                let i = this.xmax + this.pointDensity;
                i < newWidth;
                i += this.pointDensity
            ) {
                for (let j = 0; j < this.ymax; j += this.pointDensity) {
                    this.fixedPoints.push(
                        generatePoint(i, j, this.pointDensity)
                    );
                }
            }
        }
        // right
        if (newHeight > this.ymax) {
            for (let i = 0; i < this.xmax; i += this.pointDensity) {
                for (
                    let j = this.ymax + this.pointDensity;
                    j < newHeight;
                    j += this.pointDensity
                ) {
                    this.fixedPoints.push(
                        generatePoint(i, j, this.pointDensity)
                    );
                }
            }
        }
        // bottom right corner
        if (newWidth > this.xmax && newHeight > this.ymax) {
            for (let i = this.xmax + this.pointDensity * 2; i < newWidth; i++) {
                for (
                    let j = this.ymax + this.pointDensity * 2;
                    j < newHeight;
                    j++
                ) {
                    this.fixedPoints.push(
                        generatePoint(i, j, this.pointDensity)
                    );
                }
            }
        }

        // regenerate voronoi
        this.delaunayInput = new Float64Array(2 * this.fixedPoints.length);
        this.fixedPoints.forEach((point, index) => {
            const offset = 2 * index;
            this.delaunayInput[offset] = point.location.x;
            this.delaunayInput[offset + 1] = point.location.y;
        });
        const delaunay = new Delaunay(this.delaunayInput);
        this.voronoi = delaunay.voronoi([0, 0, newWidth, newHeight]);

        // resize internal canvas
        this.xmax = newWidth;
        this.ymax = newHeight;
        this.context.viewport(0, 0, newWidth, newHeight);
        this.draw();
    }
}

class Point {
    location: Vector2;
    color: d3.RGBColor;

    constructor(location: Vector2, color: d3.RGBColor | null = null) {
        this.location = location;
        this.color = color ?? RGB.random();
    }

    toString() {
        return this.location.toString();
    }
}

class Vector2 {
    x: number;
    y: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    toString() {
        return `(${this.x}, ${this.y})`;
    }

    minus(other: Vector2): Vector2 {
        return new Vector2(this.x - other.x, this.y - other.y);
    }

    plus(other: Vector2): Vector2 {
        return new Vector2(this.x + other.x, this.y + other.y);
    }
}

class RGB {
    r: number;
    g: number;
    b: number;

    /**
     * Initialize a new RGB value
     * @param r 0...1
     * @param g 0...1
     * @param b 0...1
     */
    constructor(r: number, g: number, b: number) {
        this.r = r;
        this.g = g;
        this.b = b;
    }

    static random(): d3.RGBColor {
        const color = d3.rgb(
            `rgb(${Math.random()}, ${Math.random()}, ${Math.random()})`
        );
        console.debug('color', color);
        return color;
    }

    static randomDark(): d3.RGBColor {
        const h = Math.random() * 90;
        const s = Math.random() * 0.2 + 0.2;
        const v = Math.random() * 0.2;
        const color = hsv(h, s, v).rgb() as d3.RGBColor;
        return color;
    }

    static randomBright(): d3.RGBColor {
        const h = Math.random() * 90 + 90;
        const s = Math.random() * 0.2 + 0.8;
        const v = Math.random() * 0.2 + 0.8;
        const color = hsv(h, s, v).rgb() as d3.RGBColor;
        return color;
    }

    /**
     * @returns rgb(r*255, g*255, b*255)
     */
    toString(): string {
        return `rgb(${this.r * 255}, ${this.g * 255}, ${this.b * 255})`;
    }
}

export const Background: FunctionComponent<{}> = ({}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [gameBoard, setGameBoard] = useState<GameBoard>();

    useEffect(() => {
        if (!gameBoard) {
            const canvas = canvasRef.current as HTMLCanvasElement;
            const context = canvas.getContext(
                'webgl2'
            ) as WebGL2RenderingContext;
            setGameBoard(
                new GameBoard(context, window.innerWidth, window.innerHeight)
            );
        }
    }, [gameBoard]);

    useEffect(() => {
        if (gameBoard) {
            const canvas = canvasRef.current as HTMLCanvasElement;
            const context = canvas.getContext(
                'webgl2'
            ) as WebGL2RenderingContext;
            const App = document.querySelector('#App');
            const observer = new ResizeObserver((event) => {
                const newWidth = event[0].contentRect.width;
                const newHeight = event[0].contentRect.height;
                context.canvas.width = newWidth;
                context.canvas.height = newHeight;
                gameBoard.resize(newWidth, newHeight);
            });
            if (App) {
                observer.observe(App);
            }
            return () => observer.disconnect();
        }
    }, [gameBoard]);

    return (
        <canvas
            ref={canvasRef}
            width={window.innerWidth}
            height={window.innerHeight}
            id="voronoiRoverCanvas"
        />
    );
};
