import './3d-force-graph.css';

import './threeGlobal';
import 'three/examples/js/controls/TrackBallControls';
import './ColladaLoader';

import * as d3 from 'd3-force-3d';
import graph from 'ngraph.graph';
import forcelayout from 'ngraph.forcelayout';
import forcelayout3d from 'ngraph.forcelayout3d';
const ngraph = { graph, forcelayout, forcelayout3d };

// A Simple Web Component library, inspired by the reusable charts pattern commonly found in D3 components.
import Kapsule from 'kapsule';

const CAMERA_DISTANCE2NODES_FACTOR = 150;


// The config object passed to Kapsule supports 5 properties: props, methods, stateInit, init and update.
		// All of these are optional and not required for the component to work, however calling Kapsule({}) generates
		// a dumb component that has no functionality nor interaction.
export default Kapsule({

	// props: { propName: propConfig, ... }

			// Each registered prop inside props will declare its own getter/setter method in the component's instance state.
			// This method will have the signature: myInstance.propName([propVal]).

			// If called without an argument, the method will function as a getter, returning the current value of the prop.
			// If called with a value it will act as a setter, setting the value in the component's internal state,
			// and returning the component's instance for convenience of method chaining.
	props: {
		width: { default: window.innerWidth },		// Getter/setter for the canvas width.
		height: { default: window.innerHeight },	// Getter/setter for the canvas height.
		jsonUrl: {},															// URL of JSON file to load graph data directly from, as an alternative to specifying graphData directly
		graphData: {
			default: {
				nodes: [],
				links: []
			},
			onChange(_, state) { state.onFrame = null; } // Pause simulation
		},																				// Getter/setter for graph data structure (see below for syntax details). Can also be used to apply incremental updates.
		numDimensions: { default: 3 },						// Getter/setter for number of dimensions to run the force simulation on (1, 2 or 3).
		nodeRelSize: { default: 4 }, 							// volume per val unit
		nodeResolution: { default: 8 }, 					// how many slice segments in the sphere's circumference
		onNodeClick: {},													// Callback function for node clicks. The node object is included as single argument onNodeClick(node)
		lineOpacity: { default: 0.2 },						// Getter/setter for line opacity of links, between [0,1].
		autoColorBy: {},													// Node object accessor attribute to automatically group colors by, only affects nodes without a color attribute.
		idField: { default: 'id' },								// Node object accessor attribute for unique node id (used in link objects source/target).
		valField: { default: 'val' },							// Node object accessor attribute for node numeric value (affects sphere volume).
		nameField: { default: 'name' },						// Node object accessor attribute for name (shown in label).
		colorField: { default: 'color' },					// Node object accessor attribute for node color (affects sphere color)
		linkSourceField: { default: 'source' },		// Link object accessor attribute referring to id of source node.
		linkTargetField: { default: 'target' },		// Link object accessor attribute referring to id of target node.
		forceEngine: { default: 'd3' }, 					// Getter/setter for which force-simulation engine to use (d3 or ngraph).
		warmupTicks: { default: 0 }, 							// Getter/setter for number of layout engine cycles to dry-run at ignition before starting to render. how many times to tick the force engine at init before starting to render
		cooldownTicks: { default: Infinity },			// Getter/setter for how many build-in frames to render before stopping and freezing the layout engine.
		cooldownTime: { default: 15000 }, 					// Getter/setter for how long (ms) to render for before stopping and freezing the layout engine.
		modelURL: { default: '../../../models/elf/elf.dae'}
	},


	// init(domNode, state, componentOptions)
			// This method initializes the web component by attaching it to a DOM element.
			// This method gets triggered only when the instance is called by the consumer as myInstance(<domElement>).
			// This is generally only called once for the whole lifecycle of the component's instance.

			// This is where DOM operations should be performed for the static parts of the document that do not change throughout its lifecycle.
	init(domNode, state) {
		// Wipe DOM
		domNode.innerHTML = '';

		// Add nav info section
		let navInfo;
		domNode.appendChild(navInfo = document.createElement('div'));
		navInfo.className = 'graph-nav-info';
		navInfo.textContent = "MOVE mouse & press LEFT/A: rotate, MIDDLE/S: zoom, RIGHT/D: pan";

		// Add info space
		domNode.appendChild(state.infoElem = document.createElement('div'));
		state.infoElem.className = 'graph-info-msg';
		state.infoElem.textContent = '';

		// Setup tooltip
		const toolTipElem = document.createElement('div');
		toolTipElem.classList.add('graph-tooltip');
		domNode.appendChild(toolTipElem);

		// Capture mouse coords on move
		const raycaster = new THREE.Raycaster();
		const mousePos = new THREE.Vector2();
		mousePos.x = -2; // Initialize off canvas
		mousePos.y = -2;
		domNode.addEventListener("mousemove", ev => {
			// update the mouse pos
			const offset = getOffset(domNode),
				relPos = {
					x: ev.pageX - offset.left,
					y: ev.pageY - offset.top
				};
			mousePos.x = (relPos.x / state.width) * 2 - 1;
			mousePos.y = -(relPos.y / state.height) * 2 + 1;

			// Move tooltip
			toolTipElem.style.top = (relPos.y - 40) + 'px';
			toolTipElem.style.left = (relPos.x - 20) + 'px';

			function getOffset(el) {
				const rect = el.getBoundingClientRect(),
					scrollLeft = window.pageXOffset || document.documentElement.scrollLeft,
					scrollTop = window.pageYOffset || document.documentElement.scrollTop;
				return { top: rect.top + scrollTop, left: rect.left + scrollLeft };
			}
		}, false);

		// Handle click events on nodes
		domNode.addEventListener("click", ev => {
			if (state.onNodeClick) {
				raycaster.setFromCamera(mousePos, state.camera);
				const intersects = raycaster.intersectObjects(state.graphScene.children)
					.filter(o => o.object.__data); // Check only objects with data (nodes)
				if (intersects.length) {
					state.onNodeClick(intersects[0].object.__data);
				}
			}
		}, false);

		// Setup renderer
		state.renderer = new THREE.WebGLRenderer();
		domNode.appendChild(state.renderer.domElement);

		// Setup scene
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x000011);
		scene.add(state.graphScene = new THREE.Group());

		// Add lights
		scene.add(new THREE.AmbientLight(0xbbbbbb));
		scene.add(new THREE.DirectionalLight(0xffffff, 0.6));

		// Setup camera
		state.camera = new THREE.PerspectiveCamera();
		state.camera.far = 20000;

		// Add camera interaction
		const tbControls = new THREE.TrackballControls(state.camera, state.renderer.domElement);

		// Add D3 force-directed layout
		state.d3ForceLayout = d3.forceSimulation()
			.force('link', d3.forceLink())
			.force('charge', d3.forceManyBody())
			.force('center', d3.forceCenter())
			.stop();

					// console.log("momo debug: Add D3 force-directed layout. state.d3ForceLayout is", state.d3ForceLayout);
					// console.log("momo debug: Add D3 force-directed layout. state.graphScene.children is", state.graphScene.children);	// [ ]
		//

		// Kick-off renderer
		(function animate() { // IIFE
			if(state.onFrame) state.onFrame();

			// Update tooltip
			raycaster.setFromCamera(mousePos, state.camera);
			const intersects = raycaster.intersectObjects(state.graphScene.children)
				.filter(o => o.object.name); // Check only objects with labels
			toolTipElem.textContent = intersects.length ? intersects[0].object.name : '';

			// Frame cycle
			tbControls.update();
			state.renderer.render(scene, state.camera);
			requestAnimationFrame(animate);
		})();
	},

	// update(state)
			// This method is triggered once right after the init method finishes, and afterwards whenever a prop changes.
			// This method should contain the DOM operations for the dynamic parts of the document that change according to the component props.
	update: function updateFn(state) {
		resizeCanvas();

		state.onFrame = null; // Pause simulation
		state.infoElem.textContent = 'Loading...';

		if (state.graphData.nodes.length || state.graphData.links.length) {
			console.info('3d-force-graph loading', state.graphData.nodes.length + ' nodes', state.graphData.links.length + ' links');
		}

		if (!state.fetchingJson && state.jsonUrl && !state.graphData.nodes.length && !state.graphData.links.length) {
			// (Re-)load data
			state.fetchingJson = true;
			qwest.get(state.jsonUrl).then((_, json) => {
				state.fetchingJson = false;
				state.graphData = json;
				updateFn(state);  // Force re-update
			});
		}

		// Auto add color to uncolored nodes
		autoColorNodes(state.graphData.nodes, state.autoColorBy, state.colorField);

		// parse links
		state.graphData.links.forEach(link => {
			link.source = link[state.linkSourceField];
			link.target = link[state.linkTargetField];
		});

							// console.log("momo debug: BEFORE ADD WebGL OBJECTS. state.graphScene.children is", state.graphScene.children);  // [ ]
		// Add WebGL objects
		while (state.graphScene.children.length) { state.graphScene.remove(state.graphScene.children[0]) } // Clear the place
							// console.log("momo debug: WHILE ADD WebGL OBJECTS. state.graphScene.children is", state.graphScene.children);	// [ ]

		/*
		let sphereGeometries = {}; // indexed by node value
		let sphereMaterials = {}; // indexed by color

							// console.log("momo debug: BEFORE FOR EACH ADD WebGL OBJECTS. state.graphScene is", state.graphScene);

		state.graphData.nodes.forEach(node => {
							console.log("momo debug: ADD WebGL OBJECTS. node is", node);
							console.log("momo debug: ADD WebGL OBJECTS. node[state.valField] is", node[state.valField]);
							console.log("momo debug: ADD WebGL OBJECTS. node.vx is", node.vx);	// undefined
							console.log("momo debug: ADD WebGL OBJECTS. node.vy is", node.vy);	// undefined
							console.log("momo debug: ADD WebGL OBJECTS. node.vz is", node.vz);	// undefined
							console.log("momo debug: ADD WebGL OBJECTS. node.x is", node.x);		// undefined
							console.log("momo debug: ADD WebGL OBJECTS. node.y is", node.y);		// undefined
							console.log("momo debug: ADD WebGL OBJECTS. node.z is", node.z);		// undefined
			const val = node[state.valField] || 1;
							console.log("momo debug: ADD WebGL OBJECTS. val is", val);
			if (!sphereGeometries.hasOwnProperty(val)) {
				sphereGeometries[val] = new THREE.SphereGeometry(Math.cbrt(val) * state.nodeRelSize, state.nodeResolution, state.nodeResolution);
		 					console.log("momo debug: ADD WebGL OBJECTS. sphereGeometries[val] is", sphereGeometries[val]);
			}

			const color = node[state.colorField] || 0xffffaa;
			if (!sphereMaterials.hasOwnProperty(color)) {
				sphereMaterials[color] = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.75 });
		 					console.log("momo debug: ADD WebGL OBJECTS. sphereMaterials[color] is", sphereMaterials[color]);
			}

			const sphere = new THREE.Mesh(sphereGeometries[val], sphereMaterials[color]);
		 					console.log("momo debug: ADD WebGL OBJECTS. sphere is", sphere);
							console.log("momo debug: ADD WebGL OBJECTS. sphere.position.x is", sphere.position.x);	// 0
							console.log("momo debug: ADD WebGL OBJECTS. sphere.position.y is", sphere.position.y);	// 0
							console.log("momo debug: ADD WebGL OBJECTS. sphere.position.z is", sphere.position.z);	// 0
			sphere.name = node[state.nameField]; // Add label
		 					console.log("momo debug: ADD WebGL OBJECTS. sphere.name is", sphere.name);
			sphere.__data = node; // Attach node data
		 					console.log("momo debug: ADD WebGL OBJECTS. sphere.__data is", sphere.__data);
			console.log("momo debug: ADD WebGL OBJECTS. sphere.__data.vx is", sphere.__data.vx);
			console.log("momo debug: ADD WebGL OBJECTS. sphere.__data.vy is", sphere.__data.vy);
			console.log("momo debug: ADD WebGL OBJECTS. sphere.__data.vz is", sphere.__data.vz);
			console.log("momo debug: ADD WebGL OBJECTS. sphere.__data.x is", sphere.__data.x);
			console.log("momo debug: ADD WebGL OBJECTS. sphere.__data.y is", sphere.__data.y);
			console.log("momo debug: ADD WebGL OBJECTS. sphere.__data.z is", sphere.__data.z);

							console.log("momo debug: ADD WebGL OBJECTS - BEFORE FIRST state.graphScene.add. state.graphScene is", state.graphScene);	// 0
			state.graphScene.add(node.__sphere = sphere);
							console.log("momo debug: ADD WebGL OBJECTS. state.graphScene.children is", state.graphScene.children);	// 0
		});
							console.log("momo debug: AFTER FOR EACH ADD WebGL OBJECTS. state.graphScene.children is", state.graphScene.children);
							console.log("momo debug: AFTER FOR EACH ADD WebGL OBJECTS. state.graphScene is", state.graphScene);
		*/

		// Add collada model
		var dae;
		var loader = new THREE.ColladaLoader();

		loader.options.convertUpAxis = true;
		loader.load( state.modelURL, loadCollada);

		function loadCollada( collada ) {
			dae = collada.scene;
			state.referenceModel = collada.scene.children[0].children[0];
			console.log(state.referenceModel);
			instantiateColladas();
		}

		function instantiateColladas() {
			state.graphData.nodes.forEach(node => {

				var refObject = state.referenceModel;
				console.log('loading collada instances.  state.referenceModel is:', refObject);
				var clone = new THREE.Mesh( refObject.geometry, refObject.material );
				clone.name = node[state.nameField]; // Add label
				clone.__data = node; // Attach node data
				clone.position.set(node.x, node.y, node.z);
				clone.rotation.x = Math.PI / 2;

				// here you can apply transformations, for this clone only
				state.graphScene.add( node.__clone = clone );

				// var dae;
				// var loader = new THREE.ColladaLoader();
				//
				// loader.name = node[state.nameField]; // Add label
				// loader.__data = node; // Attach node data
				// loader.options.convertUpAxis = true;
				// loader.load( '../../../models/elf/elf.dae', loadCollada);
				//
				// function loadCollada( collada ) {
				// 	dae = collada.scene;
				// 	dae.position.set(node.x, node.y, node.z);
				// 	state.graphScene.add(node.__loader = dae);
				// 	console.log(dae);
				// }
			});
		}

		// state.graphData.nodes.forEach(node => {
			// node.__loader = null;

			// var refObject = state.referenceModel;
			// console.log('loading collada instances.  state.referenceModel is:', refObject);
			// var clone = new THREE.Mesh( refObject.geometry, refObject.material );
			// clone.name = node[state.nameField]; // Add label
			// clone.__data = node; // Attach node data
			// clone.position.set(node.x, node.y, node.z);

			// here you can apply transformations, for this clone only
			// state.graphScene.add( node.__clone = clone );

			// var dae;
			// var loader = new THREE.ColladaLoader();
      //
			// loader.name = node[state.nameField]; // Add label
			// loader.__data = node; // Attach node data
			// loader.options.convertUpAxis = true;
			// loader.load( '../../../models/elf/elf.dae', loadCollada);
      //
			// function loadCollada( collada ) {
			// 	dae = collada.scene;
			// 	dae.position.set(node.x, node.y, node.z);
			// 	state.graphScene.add(node.__loader = dae);
			// 	console.log(dae);
			// }
		// });

		const lineMaterial = new THREE.LineBasicMaterial({ color: 0xf0f0f0, transparent: true, opacity: state.lineOpacity });
		state.graphData.links.forEach(link => {
			const geometry = new THREE.BufferGeometry();
			geometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
			const line = new THREE.Line(geometry, lineMaterial);

			line.renderOrder = 10; // Prevent visual glitches of dark lines on top of spheres by rendering them last

			state.graphScene.add(link.__line = line);
							// console.log("momo debug: ADD WebGL OBJECTS - LINES. state.graphScene.children is", state.graphScene.children);
		});
							// console.log("momo debug: AFTER FOR EACH ADD WebGL OBJECTS - LINES. state.graphScene.children is", state.graphScene.children);
							// console.log("momo debug: AFTER FOR EACH ADD WebGL OBJECTS - LINES. state.graphScene is", state.graphScene);

		if (state.camera.position.x === 0 && state.camera.position.y === 0) {
			// If camera still in default position (not user modified)
			state.camera.lookAt(state.graphScene.position);
			state.camera.position.z = Math.cbrt(state.graphData.nodes.length) * CAMERA_DISTANCE2NODES_FACTOR;
		}

		// Feed data to force-directed layout
		const isD3Sim = state.forceEngine !== 'ngraph';
		let layout;
		if (isD3Sim) {
							// console.log("momo debug: Feed data to force-directed layout - layout is", layout);
			// D3-force
			(layout = state.d3ForceLayout)
				.stop()
				.alpha(1)// re-heat the simulation
				.numDimensions(state.numDimensions)
				.nodes(state.graphData.nodes)
				.force('link')
					.id(d => d[state.idField])
					.links(state.graphData.links);
							// state.graphData.nodes.forEach(node => { console.log("momo debug: Feed data to force-directed layout FOR EACH - node is", node); });
		} else {
			// ngraph
			const graph = ngraph.graph();
			state.graphData.nodes.forEach(node => { graph.addNode(node[state.idField]); });
			state.graphData.links.forEach(link => { graph.addLink(link.source, link.target); });
			layout = ngraph['forcelayout' + (state.numDimensions === 2 ? '' : '3d')](graph);
			layout.graph = graph; // Attach graph reference to layout
		}

		for (let i=0; i<state.warmupTicks; i++) { layout[isD3Sim?'tick':'step'](); } // Initial ticks before starting to render

		let cntTicks = 0;
		const startTickTime = new Date();
		state.onFrame = layoutTick;
		state.infoElem.textContent = '';

		//

		function resizeCanvas() {
			if (state.width && state.height) {
				state.renderer.setSize(state.width, state.height);
				state.camera.aspect = state.width/state.height;
				state.camera.updateProjectionMatrix();
			}
		}

		function layoutTick() {
							// console.log("momo debug: CALLED layoutTick()");
			if (cntTicks++ > state.cooldownTicks || (new Date()) - startTickTime > state.cooldownTime) {
				state.onFrame = null; // Stop ticking graph
			}

			layout[isD3Sim?'tick':'step'](); // Tick it
							// console.log("momo debug: CALLED layoutTick() - layout is", layout);
							// console.log("momo debug: CALLED layoutTick() - cntTicks is", cntTicks);

			 // Update nodes position
			 state.graphData.nodes.forEach(node => {
				 const clone = node.__clone;
				 // console.log("momo debug: UPDATE POSITION - BEFORE SET NEW POSITION. sphere is", node.__sphere);
				 // console.log("momo debug: UPDATE POSITION - BEFORE SET NEW POSITION. sphere.position.x is", node.__sphere.position.x);
				 // console.log("momo debug: UPDATE POSITION - BEFORE SET NEW POSITION. sphere.position.y is", node.__sphere.position.y);
				 // console.log("momo debug: UPDATE POSITION - BEFORE SET NEW POSITION. sphere.position.z is", node.__sphere.position.z);
				 if (!clone) return;

				 const pos = isD3Sim ? node : layout.getNodePosition(node[state.idField]);
				 // console.log("momo debug: UPDATE POSITION. node - pos is", pos);

				 clone.position.x = pos.x;
				 // console.log("momo debug: UPDATE POSITION - AFTER SET NEW POSITION. sphere.position.x is", node.__sphere.position.x);
				 clone.position.y = pos.y || 0;
				 // console.log("momo debug: UPDATE POSITION - AFTER SET NEW POSITION. sphere.position.y is", node.__sphere.position.y);
				 clone.position.z = pos.z || 0;
				 // console.log("momo debug: UPDATE POSITION - AFTER SET NEW POSITION. sphere.position.z is", node.__sphere.position.z);
			 });


			/*
			// Update nodes position
			state.graphData.nodes.forEach(node => {
				const sphere = node.__sphere;
							// console.log("momo debug: UPDATE POSITION - BEFORE SET NEW POSITION. sphere is", node.__sphere);
							// console.log("momo debug: UPDATE POSITION - BEFORE SET NEW POSITION. sphere.position.x is", node.__sphere.position.x);
							// console.log("momo debug: UPDATE POSITION - BEFORE SET NEW POSITION. sphere.position.y is", node.__sphere.position.y);
							// console.log("momo debug: UPDATE POSITION - BEFORE SET NEW POSITION. sphere.position.z is", node.__sphere.position.z);
				if (!sphere) return;

				const pos = isD3Sim ? node : layout.getNodePosition(node[state.idField]);
							// console.log("momo debug: UPDATE POSITION. node - pos is", pos);

				sphere.position.x = pos.x;
							// console.log("momo debug: UPDATE POSITION - AFTER SET NEW POSITION. sphere.position.x is", node.__sphere.position.x);
				sphere.position.y = pos.y || 0;
							// console.log("momo debug: UPDATE POSITION - AFTER SET NEW POSITION. sphere.position.y is", node.__sphere.position.y);
				sphere.position.z = pos.z || 0;
							// console.log("momo debug: UPDATE POSITION - AFTER SET NEW POSITION. sphere.position.z is", node.__sphere.position.z);
			});
			*/

			// Update links position
			state.graphData.links.forEach(link => {
				const line = link.__line;
				if (!line) return;

				const pos = isD3Sim
						? link
						: layout.getLinkPosition(layout.graph.getLink(link.source, link.target).id),
					start = pos[isD3Sim ? 'source' : 'from'],
					end = pos[isD3Sim ? 'target' : 'to'],
					linePos = line.geometry.attributes.position;

				linePos.array[0] = start.x;
				linePos.array[1] = start.y || 0;
				linePos.array[2] = start.z || 0;
				linePos.array[3] = end.x;
				linePos.array[4] = end.y || 0;
				linePos.array[5] = end.z || 0;

				linePos.needsUpdate = true;
				line.geometry.computeBoundingSphere();
			});
		}

		function autoColorNodes(nodes, colorBy, colorField) {
			if (!colorBy) return;

			// Color brewer paired set
			const colors = ['#a6cee3','#1f78b4','#b2df8a','#33a02c','#fb9a99','#e31a1c','#fdbf6f','#ff7f00','#cab2d6','#6a3d9a','#ffff99','#b15928'];

			const uncoloredNodes = nodes.filter(node => !node[colorField]),
				nodeGroups = {};

			uncoloredNodes.forEach(node => { nodeGroups[node[colorBy]] = null });
			Object.keys(nodeGroups).forEach((group, idx) => { nodeGroups[group] = idx });

			uncoloredNodes.forEach(node => {
				node[colorField] = parseInt(colors[nodeGroups[node[colorBy]] % colors.length].slice(1), 16);
			});
		}
	}
});

