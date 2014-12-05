## rax-lb-config

 1. Rename rax-lb-config.service.example to rax-lb-config.service.
 2. Edit service file with your rackspace credentials
 3. fleetctl start services/rax-lb-config.timer services/rax-lb-config.service


etcd-pkgcloud-lb will monitor etcd for keys like these:

/loadbalancers/yodlr-https/node1
/loadbalancers/yodlr-https/node2
/loadbalancers/yodlr-http/node1
/loadbalancers/yodlr-http/node2
/loadbalancers/audio-https/node1

Where the value of each key is ip:port like thus:
10.209.6.54:49153

Your load balancer name in rackspace _must_ match the names in etcd.
