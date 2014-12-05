/*
 * This is pretty ugly code, but it seems to work.
 * Needs to be refactored, but priorities! -RHK
 */

var pkgcloud = require('pkgcloud');
var async = require('async');
var util = require('util');
var _ = require('underscore');

var config = {};
config.etcd = {
  host: process.env.ETCD_PORT_4001_TCP_ADDR || process.env.ETCD || '172.17.42.1',
  port: process.env.ETCD_PORT_4001_TCP_PORT || 4001
};

var Etcd = require('node-etcd');
var etcd = new Etcd(config.etcd.host, config.etcd.port);

var RAX_LBS = {};
var RAX_NODES = {};

var ETCD_DATA = {};

var rax = pkgcloud.loadbalancer.createClient({
  region: process.env.REGION || 'DFW',
  provider: 'rackspace',
  username: process.env.RAX_ACCOUNT,
  apiKey: process.env.RAX_API
});

getEtcd();

function getEtcd() {
  etcd.get('/loadbalancers', {recursive: true}, function(err, results) {
    if (err) {
      console.log(err);
      process.exit(1);
    }
    var lbs = results.node.nodes;
    _.each(lbs, function(lb) {
      var lbName = lb.key.split('/').pop();
      ETCD_DATA[lbName] = [];
      _.each(lb.nodes, function(node) {
        var name = node.key.split('/').pop();
        var address = node.value;
        ETCD_DATA[lbName].push(address);
      });
    });
    console.log('ETCD_DATA:', util.inspect(ETCD_DATA, {depth: null}));

    rax.getLoadBalancers(function(err, lbs) {
      if (err) {
        console.log(err);
        process.exit(1);
      }
      lbs = lbs.filter(function(lb) {
        if (lb.name in ETCD_DATA) {
          return lb;
        }
      });
      _.each(lbs, function(lb) {
        RAX_LBS[lb.name] = lb;
        RAX_NODES[lb.name] = [];
      });
      getNodes();
    });
  });
}

function getNodes() {
  async.each(Object.keys(RAX_LBS), function(lb_key, callback) {
    var lb = RAX_LBS[lb_key];
    rax.getNodes(lb, function(err, nodes) {
      if (err) {
        console.log(err);
        process.exit(1);
      }
      console.log('LB',lb.name,'has',nodes.length,'nodes');
      _.each(nodes, function(node) {
        RAX_NODES[lb.name].push(node);
      });
      callback();
    });
  }, function(err) {
    if (err) {
      console.log(err);
      process.exit(1);
    }

    nodeDiff();
  });
}

var NODE_REM = {};
var NODE_ADD = {};

function nodeDiff() {
  _.each(RAX_NODES, function(nodes, lbname) {
    var etcdnodes = ETCD_DATA[lbname];
    var rmNodes = nodes.filter(function(node) {
      var nodestr = node.address+':'+node.port;
      if (!_.contains(ETCD_DATA[lbname], nodestr)) {
        console.log('Node:',nodestr,'is not in etcd. Adding to remove list');
        return true;
      }
    });
    if (rmNodes.length) {
      NODE_REM[lbname] = rmNodes;
    }
  });
  console.log('nodes to remove:',NODE_REM);

  _.each(ETCD_DATA, function(nodes, lbname) {
    var raxnodes = RAX_NODES[lbname];
    var addNodes = nodes.filter(function(node) {
      var found = false;
      _.each(raxnodes, function(raxnode) {
        var nodestr = raxnode.address+':'+raxnode.port;
        if (node === nodestr) {
          console.log('ETCD node',node,'already in load balancer');
          found = true;
        }
      });
      if (!found) {
        return node;
      }
    });

    addNodes = addNodes.map(function(node) {
      var arr = node.split(':');
      return {
        condition: 'ENABLED',
        type: 'PRIMARY',
        address: arr[0],
        port: arr[1]
      };
    });
    if (addNodes.length) {
      NODE_ADD[lbname] = addNodes;
    }
  });

  console.log('nodes to add:',NODE_ADD);

  addNodes();
}


function addNodes() {
  async.each(Object.keys(NODE_ADD), function(lbname, callback) {
    var nodes = NODE_ADD[lbname];
    if (!nodes.length) {
      return callback();
    }
    var lb = RAX_LBS[lbname];
    console.log('Adding nodes to',lbname);
    rax.addNodes(lb, nodes, callback);
  }, function(err, results) {
    if (err) {
      if (err.failCode && err.failCode == 'Unprocessable Entity') {
        console.log('LB not ready, retrying in 5 seconds');
        return setTimeout(addNodes, 5000);
      }
      console.log(err);
    }
    console.log('Done adding nodes');
    removeNodes();
  });
}

function removeNodes() {
  async.each(Object.keys(NODE_REM), function(lbname, callback) {
    var nodes = NODE_REM[lbname];
    if (!nodes.length) {
      return callback();
    }
    var lb = RAX_LBS[lbname];
    console.log('Removing nodes from',lbname);
    rax.removeNodes(lb, nodes, callback);
  }, function(err, results) {
    if (err) {
      if (err.failCode && err.failCode == 'Unprocessable Entity') {
        console.log('LB not ready, retrying in 5 seconds');
        return setTimeout(removeNodes, 5000);
      }
      console.log(err);
      process.exit(1);
    }
    console.log('Done removing nodes');
  });
}
