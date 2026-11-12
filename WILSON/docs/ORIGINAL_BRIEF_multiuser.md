I want to start working on the multiuser version of the app. For this being as large of a system as it needs to be, please take your time making the plan and lets please do research for how to make this a secure system that can be deployed in a TPN compliant space. For the backend, I want the admin of a team/company to provide their own storage solution (AWS, Supabase, etc.). for my personal team I am looking at using the Supabase solution. please make sure to do significant research on how the Wilson app works now and best practices for building an app with realtime multi user editing and for enterprise deployable tools. please also use the TPN skill to make sure that your solutions and plan are taking TPN compliances and best practices. please ask any questions that can help clarify what i want and if anything i added is not well detailed, conflicting or confusing. again please make a detailed plan. we should make this a multi session multi prompt plan. please make sure at the end of each session to check the .md file for the prompt for the next session and make any updates if needed to the next session's prompt



PLEASE MAKE SURE TO CREATE A NEW BRANCH IN THE PROJECT BEFORE STARTING CODING.



Because we are now going to building this as multi user. we will want to set some definitions. moving forward everything that is a global app setting will be referred to as company wide thing and project wide things will be related to things at a project level only.



For this I want to create the following things. We will break these up into multiple sessions but this is the list:



**Editor Timestamp** - since we will be having multiple users I want to create a new function for the rabbit tool that allows users to track the edit history of the  rabbit projects. Please review how notion and Google handle this. in the bar with the settings and help button, to the left of the settings button please place a history button that shows all edit history of the project and its databases. next to the button please show the timestamp of the last edit time. please also make sure to track and record who the editor of the project was. please have a pop up window when the user presses the history button. in the pop up window please show in a main frame the before and after values that were changed. next to the main frame add a side bar that lists each edit made by a user. similar to notion show the time stamp of when the edit was made and by who. when the user presses on a selection in the sidebar, the main frame should show the corresponding values that were changed with their before and after states. list which database was changed and the value. this pop up window should be only changes made in the corresponding project. please give the user the option to revert the project back to a specific state select. please study google and notion deeply on how to do this optimally.



**update to teams members** - please add a property in the Wilson team members page that shows all projects a team member is assigned to.



**Admin Terminal** - Since this will be deployed to multiple teams potentially, please create a robust admin terminal to manage the overall tool deployed in a team with full management of the databases, users, folders, teams, and any other things that can be helpful to manage a product with a client/users admin tool. please make sure to create a error code system to lets users report issues and let the admin of the product be able to see where the problem lies. in this terminal i should be able to see the exact API calls and any error states reported by third parties. The admin user should be able to create new users, create new teams, change passwords, allow user to setup the backend connection to the cloud storage solutions. Admin user should be able to see a log of all calls, all changes made by users. please make sure to create a debug system in this terminal as well. please use the UX laws when thinking about the terminal design. for each company please ask for an api key per company.


**User States, Credentials, Permissions levels, User Login** - since the system is to be used by multiusers and is meant for real-time team editing, we need to come up with a robust team system. to start we will create a credentials and users database. each company should have its own database for these. in the system settings please add in the teams tab for settings a place to manage the company name, company details, and the overall team administration. in the teams section, all companies should have an admin that can manage and add people to a company. they should be able to create new users, see the username and the password for each member, allow the admin to change the password if a team member forgets their password. for how a user enters the app and logs in, before they are asked for the password, using the same line/bar, ask the user for their username. for v1 it will be a simple admin created name (the user is able to change it later themselves in the settings). if the user name/login exists, then ask the user for their password. for me, the creator, my username should be: Audrey.



please make sure that if a user deletes a file that it is able to undo the delete.



for users there should be three type of user permission levels:

* Admin: can use all tools, full edit and manage projects. can manage, create and deactivate user accounts. they should be able to see all tabs in the rabbit tool. can also create projects and manage all user/team settings. add users to projects and remove them as well. can control what team members can view the rate card system. in the team members database view in the Wilson app please update to create the three views for all levels. the admin should be able to check on and off if they can see the rate card. please ask the admin user to confirm that they want to give a user rate card access. please allow the user to mark if a user can also edit the rate card as well. be able to manage permissions level for each member and selecting their permission level with a dropdown option in the team members view in the Wilson app (NOT RABBIT)
* Manager: team managers can use all tools, can fully use the rabbit tool. can assign team members to project in the rabbit tool but cannot create new users or deactivate them. can access and edit the rate card if given permission by admin. can create mew projects. can view project budget tabs in the rabbit budget tab. project owner/producer must give user access to budget. can create new projects and new versions of budgets. can manage project files. add and delete files.
* User: users can access all the tools but have less access to somethings. Users can view projects and team members but cannot create or manage them. Admin should be able to give users more specific controls for editing permissions. admin should be able to allow the user to have ability to add or delete files or limit abilities. in the rabbit tool. users should be able to view or access the budget tab  or any data in those databases. they should be able to edit tasks, assets, scenes, shots, levels, experiences but cannot access budget. they can view users in the project teams but cannot add or manage team member settings. they can create rabbit database items except for phases, add team members, or anything related to the budget. can fully use the otter and dog tool. they can manage their own user settings except for title and department. that is selected by the manager and admin users. users should be able to edit their passwords as well.



For admin when they create new users please give the user a pop up window with a button to copy the user name and password to easily paste it to a communications message.



**Updates needed for the Rabbit Tool** - For the rabbit tool, this is going to be the main one that uses the real-time active databases. this system needs to allow for multiple users to edit the database and view it at the same time. they should be able to see real time data in the database meaning any changes one user makes the other users can see other user active in the project and actively changing data. for projects managers and admins in the Wilson app should have the ability to make new projects. for the rabbit tool, while there are user permissions at a app level. there is additional permissions levels for projects. for projects, we need to visually indicate who the producer is. please add a highlight to the row of the producer and creative director. in a project the producer and creator of the project are automatically assigned as the role of manager in the tool. for this system please read the following permission for each role:

* Manager: A manager has full control and admin rights for the specific project. they can add and manage the roles of all team members. they can fully manage and edit timelines. can access the project control panel. can edit project settings. has full ability to edit all team member settings for each person.
* Reviewer: A reviewer can edit timelines, can set status for things in a project to approved and to completed (normal members SHOULD NOT BE ABLE TO). Reviewers can edit and add items to timelines, scenes, etc. Reviewers cannot user the intake tab or view/access it.
* Member: A basic member can only edit assets, tasks, scenes, shots, levels, and experiences. team tab should be a view only tab for them. Budget should not be accessible or visible for basic members. please fully hide this page from basic members. members are added by managers to projects. members can create tasks and edit tasks as well. the timeline tab should also be view only except members should be able to open the pop up window of a task and edit the tasks values/properties. members can see the project control panel but it must be view only. MEMBERS SHOULD NOT BE ABLE TO SEE THE BUDGET VARIABLES CARD IN THE PROJECTS CONTROL PANEL THIS IS FOR MANAGERS ONLY. Users cannot user the intake tab or view/access it. for basic members remove any instance of the budget in their views they should be able to see any financial data of the project.



For the summary view in the project select strip, please make sure this only shows projects assigned to a person.



For all databases in a project (assets, shots, scenes, levels, experiences, and tasks) please make sure all databases have a "last updated by" and a last update at" which is the time a database item is edited. this is to make it easier for the system to remember and for people to know who edited something last.



to confirm one thing, how members of a project are added is some with a role assignment of manager must add a member from the company team members global database.





ONLY BUDGET SNAPSHOT SHOULD BE SEEN BY MANAGERS. ALL OTHER USER TYPES SHOULD NOT SEE THE BUDGET SNAPSHOT CARD.



**Dashboard Wilson App Page** - in the home page, below the tools, please show add a page called DASHBOARD. this dashboard should be a personal dashboard a user can user to see their. in this page it should be able to access data from multiple tools. for v1 only focus on the rabbit tool databases. please use a layout and interface very similar to the Wilson task view but use the colors of the Wilson app. make sure to include the gallery view, the Kanban board view, and the table view. please make sure to have all similar functionality and pop up windows from the rabbit tool. In the dashboard users should be able to have a small database and tool for writing notes. allow the notes to have a subject that is a dropdown select. please allow the user to create their own dropdown options. allow them to also have a date field to fill out. make sure the notes page allows formatting options like bolding, underlining, headers, bullet points, links, etc. and all traditional text editing functions in the text window. please review notion for how they use text writing functions for pages. every user should have their own dashboard with their own notes. please allow for sorting, filtering, and grouping of notes. in the dashboard users should be able to edit their personal user data like pronouns etc. allow users to upload and replace and delete a profile picture for themselves.



**New Company Setup** - for the first time someone downloads and sets up a company setup process. for the process ask the user to enter the name of the company and allow the user to create the company details. ask the user to enter the company information. allow the user to create the company and after doing so ask them to fill out their own information for their profile. make sure to ask them for all the fields in a team member database item. please allow the user to make multiple users to make the initial team easily.



**New user setup** - when a new user opens the app for the first time after downloading it initially please ask them to enter what company they are with. after confirming the users company input exists in the backend, please ask them to login. if this is their first time logging in please welcome them to the app and ask them to input their user data. note: when the admin user creates the user for the first time the admin should be asked to enter name, title, and role, and all other fields. after the user is done creating their account please take them to the home page.



**THIS IS GOING TO BE THE LARGEST PART OF THE PROJECT - BACKEND FOR APPLICATION -** For rolling this out. we need to create the backend for supabase. we need to be able to store all API keys for the overall app. i need you to also create the overall databases for the application that will be hosted in supabase. to clarify all users should be using the overall database system hosted in supabase. what users/companies should be able to manually connect is their own backend storage solutions. for this system they should be able to enter the following options for storage solutions that can be input (AWS s3, Supabase, local only, local servers only, Hetzner, and google drive. please make sure to create the interfaces in the system settings for allowing the user to establish their storage solution connection. to confirm in the admin terminal the admin should be able to create and manage companies with access to the system. each company should have an empty input for the api keys for claude but allow the admin to administer the keys for the companies to access the system. please make sure to allow the user to track the session id and tokens, and have a log of all database changes and queries. please make sure to create a session ID system as well for the following:

* Auth — linking every request to a user and their permissions without re-sending credentials
* Edit locking — knowing whose changes are whose when two people open the same budget or deck
* Audit trails — logging who changed what, especially important for timecards and billable data
* Security — CSRF protection, forced logout, detecting suspicious access patterns
* Multi-device — letting the same user be logged in on two machines with independent, revokable sessions



In your Express + Postgres stack, you'd typically use express-session + connect-pg-simple, store sessions in a DB table, and hold the ID in an httpOnly cookie.



in the backend please also keep the latest version of the app stored and a place to add links for all previous builds. this is for future deployments and management of the versions people have. have a way a user can download the latest version and update their downloaded build. please make sure that every time the user logs in and a new session id is create to check if the user is using the latest version of the app. prompt the user to update the app or to skip update. in the system settings please allow a user to see the version of the app they have and allow the user check the backend for newer builds to update to. 



please make sure that with the backend users of a company in a project should be able to see realtime updates as others users make them. look at how google and notion do this and how they indicate what the other users have selected or are actively editing. 



To clarify please do as much research before you can for the plan. please make sure to think about best practices for database systems like this. please reference notion, shotgrid, obsidian, and google for how they go about their backend systems. remember im wanting to use supabase. for anything supabase related that claude cannot do please give me detailed instructions and files for me to user if needed. i have no supabase experience. 



please make sure to create an authentication system as well that supabase offers. lets use this solu8tion for now












