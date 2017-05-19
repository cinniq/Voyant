Ext.define('Voyant.widget.VoyantNetworkGraph', {
    extend: 'Ext.panel.Panel',
    mixins: ['Voyant.util.Localization','Voyant.util.Api','Voyant.notebook.util.Embed'],
    embeddable: ['Voyant.widget.VoyantNetworkGraph'],
    alias: 'widget.voyantnetworkgraph',
    statics: {
        i18n: {
        },
        api: {
            jsonData: undefined,
            docId: undefined,
            docIndex: undefined,
            json: undefined
        }
    },
    config: {
        vis: undefined, // svg > g element
        visLayout: undefined, // d3 layout algorithm
        
        // backing data, don't set through config, use config.nodes & config.edges
        nodeData: undefined,
        edgeData: undefined,
        
        nodeSelection: undefined, // d3 selection for nodes
        edgeSelection: undefined, // d3 selection for edges
        
        currentNode: undefined,
        currentEdge: undefined,
        
        scaleExtent: [0.25, 8],
        
        fixOnDrag: true, // fix node when dragged
        
        graphStyle: {
    		node: {
    			normal: {
    				fill: '#c6dbef',
    				fillOpacity: 1,
    				stroke: '#6baed6',
    				strokeOpacity: 1,
    				strokeWidth: 1
    			},
    			highlight: {
    				fill: '#9ecae1',
    				fillOpacity: 1,
    				stroke: '#3182bd',
    				strokeOpacity: 1,
    				strokeWidth: 3
    			}
    		},
    		edge: {
    			normal: {
    				stroke: '#000000',
    				strokeOpacity: 0.25,
    				strokeWidth: 1
    			},
    			highlight: {
    				stroke: '#000000',
    				strokeOpacity: 0.5,
    				strokeWidth: 3
    			}
    		}
    	},
    	
    	graphPhysics: {
    		damping: 0.4, // 0 = no damping, 1 = full damping
    		gravity: -1,  // negative = repel, positive = attract
			springLength: 30,
			springStrength: 1 // 0 = not strong, >1 = probably too strong
    	}
    },
    constructor: function(config) {
        config = config || {};
        
        this.setNodeData([]);
        this.setEdgeData([]);
        
        this.mixins['Voyant.util.Api'].constructor.apply(this, arguments);
        this.callParent(arguments);
        
        var json = {};
        if (this.getApiParam('jsonData')) {
            json = Ext.decode(this.getApiParam('jsonData'));
        } else if (this.getApiParam('json')) {
        	json = this.getApiParam('json');
        } else if (config.json) {
        	json = config.json;
        } else if (config.edges) {
        	json.edges = config.edges;
        	if (config.nodes) {
        		json.nodes = config.nodes;
        	}
        }
        this.loadJson(json);
    },
    initComponent: function(config) {
        this.on('boxready', function(src, corpus) {
            this.initGraph();
            this.refreshGraph();
        }, this);
        
        this.on('resize', function(panel, width, height) {
            var vis = this.body.down('svg');
            if (vis) {
                var el = this.body;
                var elHeight = el.getHeight();
                var elWidth = el.getWidth();
                vis.dom.setAttribute('width', elWidth);
                vis.dom.setAttribute('height', elHeight);
                this.getVisLayout()
                    .force('center', d3.forceCenter(elWidth/2, elHeight/2))
                    .alpha(0.3).restart();
            }
        }, this);
        
        this.callParent(arguments);
    },
    
    processJson: function(json) {
    	if (!json || !json.edges) {
            if (json && json.links) {
                json.edges = json.links;
                delete json.links;
            }
            if (!json || !json.edges) {
                json = json || {};
                json.edges = [];
            }
        }
    	if (!json.nodes) {
    		json.nodes = [];
    	}
        if (json.nodes.length === 0) {
            var wordFreq = {};
            json.edges.forEach(function(edge) {
                ['source', 'target'].forEach(function(loc) {
                	var term = edge[loc];
                    if (term in wordFreq == false) {
                        wordFreq[term] = 1;
                        json.nodes.push({term: term});
                    } else {
                        wordFreq[term]++;
                    }
                    edge.value = 1;
                });
            }, this);
            json.nodes.forEach(function(node) {
                Ext.applyIf(node, {value: wordFreq[node.term]});
            });
        }
        
        return json;
    },
    
    loadJson: function(json) {
    	this.processJson(json);
    	
    	var existingTerms = {};
		this.getNodeData().forEach(function(node) {
			existingTerms[node.term] = true;
		}, this);
		
    	var newNodes = [];
    	var newEdges = [];
    	
    	json.nodes.forEach(function(node) {
            if (existingTerms[node.term] === undefined) {
            	node.id = this.idGet(node.term);
            	newNodes.push(node);
            }
        }, this);
        json.edges.forEach(function(newedge) {
            var sourceId = this.idGet(newedge.source);
            var targetId = this.idGet(newedge.target);
            var edges = this.getEdgeData();
            var exists = false;
            for (var i = 0; i < edges.length; i++) {
            	var edge = edges[i];
            	if ((edge.source.id == sourceId && edge.target.id == targetId) || (edge.target.id == sourceId && edge.source.id == targetId)) {
            		exists = true;
            		break;
            	}
            }
            if (!exists) {
            	newedge.source = sourceId;
            	newedge.target = targetId;
            	newedge.id = sourceId+'-'+targetId;
	            newEdges.push(newedge);
            }
        }, this);
        
        this.setNodeData(this.getNodeData().concat(newNodes));
        this.setEdgeData(this.getEdgeData().concat(newEdges));
        
        this.refreshGraph();
    },
    
    // get a DOM appropriate id
    idGet: function(term) {
    	return term.replace(/\W/g, '_');
    },
    
    updateDataForNode: function(nodeId, dataObj) {
    	var data = this.getNodeData();
		for (var i = 0; i < data.length; i++) {
			if (data[i].id === nodeId) {
				Ext.apply(data[i], dataObj);
				break;
			}
		}
    },
    
    updateDataForEdge: function(edgeId, dataObj) {
    	var data = this.getEdgeData();
		for (var i = 0; i < data.length; i++) {
			if (data[i].id === edgeId) {
				Ext.apply(data[i], dataObj);
				break;
			}
		}
    },
    
    addNode: function(dataObj) {
    	if (Ext.isString(dataObj)) {
    		dataObj = {term: dataObj};
    	}
    	if (dataObj.term) {
    		this.loadJson({nodes: [dataObj]});
    	}
    },
    
    removeNode: function(nodeId, removeOrphans) {
    	var data = this.getNodeData();
		for (var i = 0; i < data.length; i++) {
			if (data[i].id === nodeId) {
				data.splice(i, 1);
				break;
			}
		}
		
		var potentialOrphans = {};
		data = this.getEdgeData();
		for (var i = data.length-1; i >= 0; i--) {
			var match = false;
			if (data[i].source.id === nodeId) {
				match = true;
				potentialOrphans[data[i].target.id] = true;
			}
			if (data[i].target.id === nodeId) {
				match = true;
				potentialOrphans[data[i].source.id] = true;
			}
			if (match) {
				data.splice(i, 1);
			}
		}
		
		if (removeOrphans) {
			for (var i = 0; i < data.length; i++) {
				if (potentialOrphans[data[i].source.id]) {
					delete potentialOrphans[data[i].source.id];
				}
				if (potentialOrphans[data[i].target.id]) {
					delete potentialOrphans[data[i].target.id];
				}
			}
			for (var orphanId in potentialOrphans) {
				this.removeNode(orphanId, true);
			}
		}
		
		this.refreshGraph();
    },
    
    addEdge: function(dataObj) {
    	if (Ext.isObject(dataObj) && dataObj.source && dataObj.target) {
    		this.loadJson({edges: [dataObj]});
    	}
    },
    
    removeEdge: function(edgeId, removeOrphans) {
    	var data = this.getEdgeData();
    	for (var i = data.length-1; i >= 0; i--) {
			if (data[i].id === edgeId) {
				data.splice(i, 1);
			}
		}
		
		if (removeOrphans) {
			var potentialOrphans = {};
			data = this.getNodeData();
			for (var i = 0; i < data.length; i++) {
				potentialOrphans[data[i].id] = true;
			}
			data = this.getEdgeData();
			for (var i = 0; i < data.length; i++) {
				if (potentialOrphans[data[i].source.id]) {
					delete potentialOrphans[data[i].source.id];
				}
				if (potentialOrphans[data[i].target.id]) {
					delete potentialOrphans[data[i].target.id];
				}
			}
			for (var orphanId in potentialOrphans) {
				this.removeNode(orphanId, true);
			}
			
		}
		
		this.refreshGraph();
    },
    
    initGraph: function() {
        var el = this.getLayout().getRenderTarget();
        el.update('');
        var width = el.getWidth();
        var height = el.getHeight();
        
        var physics = this.getGraphPhysics();
        this.setVisLayout(d3.forceSimulation()
        	.velocityDecay(physics.damping)
    		.force('center', d3.forceCenter(width/2, height/2))
            .force('link', d3.forceLink().id(function(d) { return d.id; }).distance(physics.springLength).strength(physics.springStrength))
            .force('charge', d3.forceManyBody().strength(physics.gravity))
            .force('collide', d3.forceCollide().radius(function(d) { return Math.sqrt(d.bbox.width * d.bbox.height)*2; }))
            .on('tick', function() {
            	 this.getEdgeSelection()
	                .attr('x1', function(d) { return d.source.x; })
	                .attr('y1', function(d) { return d.source.y; })
	                .attr('x2', function(d) { return d.target.x; })
	                .attr('y2', function(d) { return d.target.y; });
	    
            	 this.getNodeSelection()
            	 	.attr('transform', function(d) {
            	 		var x = d.x - d.bbox.width*0.5;
            	 		var y = d.y - d.bbox.height*0.5;
            	 		return 'translate('+x+','+y+')';
        	 		});
	        }.bind(this)
        ));
        
        var svg = d3.select(el.dom).append('svg').attr('width', width).attr('height', height);
        var g = svg.append('g');
        
        svg.call(d3.zoom().scaleExtent(this.getScaleExtent()).on('zoom', function() {
            g.attr('transform', d3.event.transform);
        }));
        
        this.setEdgeSelection(g.append('g').attr('class', 'edges').selectAll('.edge'));
        this.setNodeSelection(g.append('g').attr('class', 'nodes').selectAll('.node'));
        this.setVis(g);
    },
    
    resetGraph: function() {
	    this.setNodeData([]);
		this.setEdgeData([]);
		this.refreshGraph();
    },
    
    refreshGraph: function() {
    	if (this.getVisLayout() === undefined) return;
    	
        var edgeData = this.getEdgeData();
        var nodeData = this.getNodeData();
        
        var edge = this.getEdgeSelection().data(edgeData, function(d) { return d.id; });
        edge.exit().remove();
        var edgeEnter = edge.enter().append('line')
        	.attr('class', 'edge')
        	.attr('id', function(d) { return d.id; })
        	.style('cursor', 'pointer')
        	.on('mouseover', this.edgeMouseOver.bind(this))
            .on('mouseout', this.edgeMouseOut.bind(this))
        	.on('click', function(d) {
        		d3.event.stopImmediatePropagation();
				d3.event.preventDefault();
				this.setCurrentEdge(d);
				this.fireEvent('edgeclicked', this, d);
        	}.bind(this));
        
        this.setEdgeSelection(edgeEnter.merge(edge));
        
        var node = this.getNodeSelection().data(nodeData, function(d) { return d.id; });
        node.exit().remove();
        var nodeEnter = node.enter().append('g')
            .attr('class', 'node')
            .attr('id', function(d) { return d.id; })
            .style('cursor', 'pointer')
            .on('mouseover', this.nodeMouseOver.bind(this))
            .on('mouseout', this.nodeMouseOut.bind(this))
            .on('click', function(d) {
				d3.event.stopImmediatePropagation();
				d3.event.preventDefault();
				this.setCurrentNode(d);
				this.fireEvent('nodeclicked', this, d);
			}.bind(this))
			.on('dblclick', function(d) {
				d3.event.stopImmediatePropagation();
				d3.event.preventDefault();
				this.fireEvent('nodedblclicked', this, d);
			}.bind(this))
            .call(d3.drag()
                .on('start', function(d) {
                    if (!d3.event.active) this.getVisLayout().alphaTarget(0.3).restart();
                    if (this.getFixOnDrag()) {
	                    d.fx = d.x;
	                    d.fy = d.y;
                    }
                    this.fireEvent('dragstart', this, d);
            	}.bind(this))
                .on('drag', function(d) {
                	if (this.getFixOnDrag()) {
	                    d.fx = d3.event.x;
	                    d.fy = d3.event.y;
                	} else {
                		d.x = d3.event.x;
                		d.y = d3.event.y;
                	}
                    this.fireEvent('drag', this, d);
                }.bind(this))
                .on('end', function(d) {
                	if (!d3.event.active) this.getVisLayout().alphaTarget(0);
                	this.fireEvent('dragend', this, d);
                }.bind(this))
            );

        nodeEnter.append('rect');
        
        var vals = nodeData.map(function(d) {
            var val = d.value;
            if (d.value == undefined) {
                d.value = val = 1;
            }
            return val;
        });
        vals.sort();
        var fontscale = d3.scaleLog()
            .domain([vals[0], vals[vals.length-1]])
            .range([8, 36]);
                
        nodeEnter.append('text')
            .text(function(d) { return d.term; })
//            .attr('font-family', function(d) { return this.getApplication().getFeatureForTerm('font', d.term); }.bind(this))
            .attr('font-size', function(d) {return fontscale(d.value)+'px';})
//            .attr('text-anchor', 'middle')
			.attr('alignment-baseline', 'middle')
			.style('user-select', 'none')
            .each(function(d) { d.bbox = this.getBBox(); });
        
        this.setNodeSelection(nodeEnter.merge(node));
        
        this.getNodeSelection().selectAll('rect')
        	.attr('width', function(d) { return d.bbox.width+16; })
			.attr('height', function(d) { return d.bbox.height+8; })
			.attr('rx', function(d) { return Math.max(2, d.bbox.height * 0.2); })
			.attr('ry', function(d) { return Math.max(2, d.bbox.height * 0.2); });
        
        this.getNodeSelection().selectAll('text')
        	.attr('dx', 8)
			.attr('dy', function(d) { return d.bbox.height*0.5+4; });
        

        this.getEdgeSelection().call(this.applyEdgeStyle.bind(this));
        this.getNodeSelection().call(this.applyNodeStyle.bind(this));
        
        this.getVisLayout().nodes(nodeData);
        this.getVisLayout().force('link').links(edgeData);
        this.getVisLayout().alpha(1).restart();
    },
    
    applyNodeStyle: function(sel, nodeState) {
		var state = nodeState === undefined ? 'normal' : nodeState;
		var style = this.getGraphStyle().node[state];
    	sel.selectAll(':not(text)')
    		.style('fill', function(d) { return style.fill; }.bind(this))
    		.style('fill-opacity', function(d) { return style.fillOpacity; }.bind(this))
    		.style('stroke', function(d) { return style.stroke; }.bind(this))
    		.style('stroke-opacity', function(d) { return style.strokeOpacity; }.bind(this))
    		.style('stroke-width', function(d) { return style.strokeWidth; }.bind(this));
    },
    
    applyEdgeStyle: function(sel, edgeState) {
    	var state = edgeState === undefined ? 'normal' : edgeState;
    	var style = this.getGraphStyle().edge[state];
    	sel.style('stroke', function(d) { return style.stroke; }.bind(this))
	    	.style('stroke-opacity', function(d) { return style.strokeOpacity; }.bind(this))
	    	.style('stroke-width', function(d) { return style.strokeWidth; }.bind(this));
    },

    edgeMouseOver: function(d) {
    	this.getEdgeSelection().call(this.applyEdgeStyle.bind(this));
    	this.getVis().select('#'+d.id).call(this.applyEdgeStyle.bind(this), 'highlight');
    },
    
    edgeMouseOut: function(d) {
    	this.getEdgeSelection().call(this.applyEdgeStyle.bind(this));
    },
    
    nodeMouseOver: function(d) {
    	this.setCurrentNode(d);
		
    	this.getNodeSelection().call(this.applyNodeStyle.bind(this));
		
		this.getEdgeSelection().each(function(link) {
			var id;
			if (link.source.id == d.id) {
				id = link.target.id;
			} else if (link.target.id == d.id) {
				id = link.source.id;
			}
			if (id !== undefined) {
				this.getVis().select('#'+id).call(this.applyNodeStyle.bind(this), 'highlight');
				this.getVis().select('#'+link.id).call(this.applyEdgeStyle.bind(this), 'highlight');
			}
		}.bind(this));
		
		this.getVis().select('#'+d.id).call(this.applyNodeStyle.bind(this), 'highlight');
    },
    
    nodeMouseOut: function(d) {
    	this.getNodeSelection().call(this.applyNodeStyle.bind(this));
    	this.getEdgeSelection().call(this.applyEdgeStyle.bind(this));
    }
});